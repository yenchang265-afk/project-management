// Notifications domain service (Phase 4c).
//
// Responsibilities:
//   - Persist in-app notifications honoring user preferences.
//   - Fan-out to email via the pg-boss queue (preference-aware).
//   - Read APIs: list (paginated), unread filter, mark-read, mark-all-read.
//   - Preference matrix: 7 kinds x 2 channels, default-enabled when no row.
//
// Design notes:
//   - The service is pure and accepts its deps (prisma, enqueueEmail) so it
//     can be unit tested with the in-memory fake and integration-tested with
//     a real Postgres + stub queue.
//   - Email enqueue failures must NOT bring down the in-app write path —
//     pg-boss can be flaky in dev/CI and notifications are best-effort.
//   - Preferences default to `enabled: true` when no row exists. Updating
//     a preference upserts. We never bulk-seed the matrix at signup.

import { z } from 'zod';
import type {
  Notification,
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  PrismaClient,
  Role,
} from '@prisma/client';

import { AuthError } from '@/lib/errors';

export type Actor = { id: string; role: Role };

export type NotificationServiceDeps = {
  prisma: PrismaClient;
  enqueueEmail?: (job: EmailJobInput) => Promise<unknown>;
};

export type EmailJobInput = {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'ISSUE_ASSIGNED',
  'ISSUE_MENTIONED',
  'ISSUE_COMMENTED',
  'ISSUE_TRANSITIONED',
  'ISSUE_CREATED_IN_WATCHED',
  'SPRINT_STARTED',
  'SPRINT_COMPLETED',
];

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL'];

export const createNotificationInputSchema = z.object({
  userId: z.string().min(1),
  kind: z.enum([
    'ISSUE_ASSIGNED',
    'ISSUE_MENTIONED',
    'ISSUE_COMMENTED',
    'ISSUE_TRANSITIONED',
    'ISSUE_CREATED_IN_WATCHED',
    'SPRINT_STARTED',
    'SPRINT_COMPLETED',
  ]),
  payload: z.record(z.unknown()).optional(),
});
export type CreateNotificationInput = z.infer<typeof createNotificationInputSchema>;

export const updatePreferenceInputSchema = z.object({
  kind: z.enum([
    'ISSUE_ASSIGNED',
    'ISSUE_MENTIONED',
    'ISSUE_COMMENTED',
    'ISSUE_TRANSITIONED',
    'ISSUE_CREATED_IN_WATCHED',
    'SPRINT_STARTED',
    'SPRINT_COMPLETED',
  ]),
  channel: z.enum(['IN_APP', 'EMAIL']),
  enabled: z.boolean(),
});
export type UpdatePreferenceInput = z.infer<typeof updatePreferenceInputSchema>;

export const listNotificationsInputSchema = z.object({
  onlyUnread: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsInputSchema>;

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AuthError('invalid_input', result.error.issues[0]?.message, result.error.flatten());
  }
  return result.data;
}

export function createNotificationService(deps: NotificationServiceDeps) {
  const { prisma, enqueueEmail } = deps;

  async function isChannelEnabled(
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const row = await prisma.notificationPreference.findUnique({
      where: { userId_kind_channel: { userId, kind, channel } },
    });
    return row?.enabled ?? true;
  }

  async function createNotification(input: CreateNotificationInput): Promise<Notification | null> {
    const data = parseOrThrow(createNotificationInputSchema, input);
    const payload = data.payload ?? {};

    const inAppEnabled = await isChannelEnabled(data.userId, data.kind, 'IN_APP');
    let row: Notification | null = null;
    if (inAppEnabled) {
      row = (await prisma.notification.create({
        data: {
          userId: data.userId,
          kind: data.kind,
          payload: payload as never,
        },
      })) as Notification;
    }

    const emailEnabled = await isChannelEnabled(data.userId, data.kind, 'EMAIL');
    if (emailEnabled && enqueueEmail) {
      try {
        await enqueueEmail({ userId: data.userId, kind: data.kind, payload });
      } catch (err) {
        // Best-effort: log and continue. The in-app notification is the
        // source of truth; email is a nice-to-have side effect.
        // eslint-disable-next-line no-console
        console.error('[notifications] enqueueEmail failed', err);
      }
    }

    return row;
  }

  async function listNotifications(
    actor: Actor,
    input: ListNotificationsInput,
  ): Promise<{
    data: Notification[];
    pageInfo: { nextCursor: string | null; hasMore: boolean };
  }> {
    const opts = parseOrThrow(listNotificationsInputSchema, input);
    const limit = opts.limit ?? 20;
    const where: { userId: string; readAt?: null } = { userId: actor.id };
    if (opts.onlyUnread) where.readAt = null;

    const rows = (await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })) as Notification[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
    return { data, pageInfo: { nextCursor, hasMore } };
  }

  async function unreadCount(actor: Actor): Promise<number> {
    return prisma.notification.count({ where: { userId: actor.id, readAt: null } });
  }

  async function markAsRead(notificationId: string, actor: Actor): Promise<Notification> {
    const row = (await prisma.notification.findUnique({
      where: { id: notificationId },
    })) as Notification | null;
    if (!row) throw new AuthError('not_found', 'Notification not found');
    if (row.userId !== actor.id) throw new AuthError('forbidden', 'Not your notification');
    if (row.readAt) return row;
    return (await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    })) as Notification;
  }

  async function markAllRead(actor: Actor): Promise<{ count: number }> {
    const result = await prisma.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  async function getPreferences(
    actor: Actor,
  ): Promise<Array<{ kind: NotificationKind; channel: NotificationChannel; enabled: boolean }>> {
    const stored = (await prisma.notificationPreference.findMany({
      where: { userId: actor.id },
    })) as NotificationPreference[];
    const byKey = new Map<string, boolean>();
    for (const row of stored) {
      byKey.set(`${row.kind}|${row.channel}`, row.enabled);
    }
    const out: Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }> = [];
    for (const kind of NOTIFICATION_KINDS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        out.push({
          kind,
          channel,
          enabled: byKey.get(`${kind}|${channel}`) ?? true,
        });
      }
    }
    return out;
  }

  async function updatePreference(
    input: UpdatePreferenceInput,
    actor: Actor,
  ): Promise<{ kind: NotificationKind; channel: NotificationChannel; enabled: boolean }> {
    const data = parseOrThrow(updatePreferenceInputSchema, input);
    await prisma.notificationPreference.upsert({
      where: {
        userId_kind_channel: { userId: actor.id, kind: data.kind, channel: data.channel },
      },
      create: {
        userId: actor.id,
        kind: data.kind,
        channel: data.channel,
        enabled: data.enabled,
      },
      update: { enabled: data.enabled },
    });
    return data;
  }

  async function addWatcher(issueId: string, userId: string): Promise<void> {
    try {
      await prisma.issueWatcher.upsert({
        where: { issueId_userId: { issueId, userId } },
        create: { issueId, userId },
        update: {},
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notifications] addWatcher failed', err);
    }
  }

  async function listWatchers(issueId: string): Promise<string[]> {
    const rows = (await prisma.issueWatcher.findMany({
      where: { issueId },
    })) as Array<{ userId: string }>;
    return rows.map((r) => r.userId);
  }

  return {
    createNotification,
    listNotifications,
    unreadCount,
    markAsRead,
    markAllRead,
    getPreferences,
    updatePreference,
    addWatcher,
    listWatchers,
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
