// Minimal in-memory Prisma fake for the notifications service unit tests.
//
// We only implement the calls notificationService actually uses. Anything
// missing should throw rather than silently no-op so tests fail loudly.

import type { NotificationChannel, NotificationKind } from '@prisma/client';

export type FakeNotification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
};

export type FakeNotificationPreference = {
  id: string;
  userId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  enabled: boolean;
};

export type FakeIssueWatcher = {
  issueId: string;
  userId: string;
  createdAt: Date;
};

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function createFakePrisma() {
  const notifications: FakeNotification[] = [];
  const prefs: FakeNotificationPreference[] = [];
  const watchers: FakeIssueWatcher[] = [];

  const notification = {
    create: async ({
      data,
    }: {
      data: {
        userId: string;
        kind: NotificationKind;
        payload: unknown;
        readAt?: Date | null;
      };
    }): Promise<FakeNotification> => {
      const row: FakeNotification = {
        id: nextId('ntf'),
        userId: data.userId,
        kind: data.kind,
        payload: data.payload,
        readAt: data.readAt ?? null,
        createdAt: new Date(Date.now() + notifications.length), // stable order
      };
      notifications.push(row);
      return { ...row };
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = notifications.find((n) => n.id === where.id);
      return row ? { ...row } : null;
    },
    findMany: async (
      args: {
        where?: { userId?: string; readAt?: null | { not: null } };
        orderBy?: { createdAt?: 'asc' | 'desc' };
        take?: number;
        cursor?: { id: string };
        skip?: number;
      } = {},
    ) => {
      let out = notifications.slice();
      if (args.where?.userId) out = out.filter((n) => n.userId === args.where!.userId);
      if (args.where && 'readAt' in args.where) {
        const r = args.where.readAt;
        if (r === null) out = out.filter((n) => n.readAt === null);
        else if (r && typeof r === 'object' && 'not' in r)
          out = out.filter((n) => n.readAt !== null);
      }
      out.sort((a, b) =>
        args.orderBy?.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      if (args.cursor) {
        const idx = out.findIndex((n) => n.id === args.cursor!.id);
        if (idx >= 0) out = out.slice(idx + (args.skip ?? 0));
      }
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out.map((n) => ({ ...n }));
    },
    update: async ({ where, data }: { where: { id: string }; data: { readAt?: Date | null } }) => {
      const row = notifications.find((n) => n.id === where.id);
      if (!row) throw new Error('not found');
      if ('readAt' in data) row.readAt = data.readAt ?? null;
      return { ...row };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { userId: string; readAt: null };
      data: { readAt: Date };
    }) => {
      let count = 0;
      for (const n of notifications) {
        if (n.userId === where.userId && n.readAt === null) {
          n.readAt = data.readAt;
          count += 1;
        }
      }
      return { count };
    },
    count: async ({ where }: { where: { userId: string; readAt?: null } }) => {
      let n = notifications.filter((x) => x.userId === where.userId);
      if (where.readAt === null) n = n.filter((x) => x.readAt === null);
      return n.length;
    },
  };

  const notificationPreference = {
    findMany: async ({ where }: { where: { userId: string } }) =>
      prefs.filter((p) => p.userId === where.userId).map((p) => ({ ...p })),
    findUnique: async ({
      where,
    }: {
      where: {
        userId_kind_channel: {
          userId: string;
          kind: NotificationKind;
          channel: NotificationChannel;
        };
      };
    }) => {
      const k = where.userId_kind_channel;
      const r = prefs.find(
        (p) => p.userId === k.userId && p.kind === k.kind && p.channel === k.channel,
      );
      return r ? { ...r } : null;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        userId_kind_channel: {
          userId: string;
          kind: NotificationKind;
          channel: NotificationChannel;
        };
      };
      create: {
        userId: string;
        kind: NotificationKind;
        channel: NotificationChannel;
        enabled: boolean;
      };
      update: { enabled: boolean };
    }) => {
      const k = where.userId_kind_channel;
      const existing = prefs.find(
        (p) => p.userId === k.userId && p.kind === k.kind && p.channel === k.channel,
      );
      if (existing) {
        existing.enabled = update.enabled;
        return { ...existing };
      }
      const row: FakeNotificationPreference = {
        id: nextId('pref'),
        userId: create.userId,
        kind: create.kind,
        channel: create.channel,
        enabled: create.enabled,
      };
      prefs.push(row);
      return { ...row };
    },
  };

  const issueWatcher = {
    findMany: async ({ where }: { where: { issueId?: string; userId?: string } }) => {
      let out = watchers.slice();
      if (where.issueId) out = out.filter((w) => w.issueId === where.issueId);
      if (where.userId) out = out.filter((w) => w.userId === where.userId);
      return out.map((w) => ({ ...w }));
    },
    upsert: async ({
      where,
      create,
    }: {
      where: { issueId_userId: { issueId: string; userId: string } };
      create: { issueId: string; userId: string };
      update: Record<string, unknown>;
    }) => {
      const k = where.issueId_userId;
      const existing = watchers.find((w) => w.issueId === k.issueId && w.userId === k.userId);
      if (existing) return { ...existing };
      const row: FakeIssueWatcher = {
        issueId: create.issueId,
        userId: create.userId,
        createdAt: new Date(),
      };
      watchers.push(row);
      return { ...row };
    },
  };

  // The post-Phase-5b security review added a `prisma.user.findUnique` guard
  // before `createNotification` writes a row, to swallow FK violations from
  // deleted users. Tests don't seed users, so stub a "user always exists"
  // response.
  const user = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id ? { id: where.id } : null,
  };

  return {
    notification,
    notificationPreference,
    issueWatcher,
    user,
    _state: { notifications, prefs, watchers },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
