import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotificationService } from '@/server/services/notifications';
import { createFakePrisma, type FakePrisma } from './fakePrisma';

const USER_A = { id: 'user_a', role: 'MEMBER' as const };
const USER_B = { id: 'user_b', role: 'MEMBER' as const };

describe('notificationService.createNotification', () => {
  let prisma: FakePrisma;
  let enqueue: ReturnType<typeof vi.fn>;
  let svc: ReturnType<typeof createNotificationService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    enqueue = vi.fn().mockResolvedValue(undefined);
    svc = createNotificationService({ prisma: prisma as never, enqueueEmail: enqueue });
  });

  it('writes a row', async () => {
    const n = await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_ASSIGNED',
      payload: { issueKey: 'P-1', actorId: USER_B.id },
    });
    expect(n).not.toBeNull();
    expect(n!.id).toBeTruthy();
    expect(n!.userId).toBe(USER_A.id);
    expect(n!.kind).toBe('ISSUE_ASSIGNED');
    expect(n!.readAt).toBeNull();
    expect(prisma._state.notifications).toHaveLength(1);
  });

  it('enqueues an email when EMAIL preference is on (default)', async () => {
    await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_MENTIONED',
      payload: { issueKey: 'P-1' },
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      userId: USER_A.id,
      kind: 'ISSUE_MENTIONED',
    });
  });

  it('does NOT enqueue email when user disabled EMAIL pref for the kind', async () => {
    await prisma.notificationPreference.upsert({
      where: {
        userId_kind_channel: {
          userId: USER_A.id,
          kind: 'ISSUE_MENTIONED',
          channel: 'EMAIL',
        },
      },
      create: {
        userId: USER_A.id,
        kind: 'ISSUE_MENTIONED',
        channel: 'EMAIL',
        enabled: false,
      },
      update: { enabled: false },
    });
    await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_MENTIONED',
      payload: { issueKey: 'P-1' },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does NOT write a row when IN_APP pref is disabled', async () => {
    await prisma.notificationPreference.upsert({
      where: {
        userId_kind_channel: {
          userId: USER_A.id,
          kind: 'ISSUE_COMMENTED',
          channel: 'IN_APP',
        },
      },
      create: {
        userId: USER_A.id,
        kind: 'ISSUE_COMMENTED',
        channel: 'IN_APP',
        enabled: false,
      },
      update: { enabled: false },
    });
    await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_COMMENTED',
      payload: { issueKey: 'P-1' },
    });
    expect(prisma._state.notifications).toHaveLength(0);
  });

  it('swallows enqueueEmail errors and still persists the in-app row', async () => {
    enqueue.mockRejectedValueOnce(new Error('queue down'));
    const n = await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_TRANSITIONED',
      payload: { issueKey: 'P-1' },
    });
    expect(n).not.toBeNull();
    expect(n!.id).toBeTruthy();
    expect(prisma._state.notifications).toHaveLength(1);
  });
});

describe('notificationService.listNotifications', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createNotificationService>;

  beforeEach(async () => {
    prisma = createFakePrisma();
    svc = createNotificationService({ prisma: prisma as never });
    for (let i = 0; i < 5; i++) {
      await svc.createNotification({
        userId: USER_A.id,
        kind: 'ISSUE_COMMENTED',
        payload: { issueKey: `P-${i}` },
      });
    }
  });

  it('returns notifications newest-first with pagination', async () => {
    const page = await svc.listNotifications(USER_A, { limit: 3 });
    expect(page.data).toHaveLength(3);
    expect(page.pageInfo.hasMore).toBe(true);
    expect(page.pageInfo.nextCursor).toBeTruthy();
    const page2 = await svc.listNotifications(USER_A, {
      limit: 3,
      cursor: page.pageInfo.nextCursor!,
    });
    expect(page2.data).toHaveLength(2);
    expect(page2.pageInfo.hasMore).toBe(false);
  });

  it('filters by onlyUnread', async () => {
    const page = await svc.listNotifications(USER_A, { limit: 50 });
    const first = page.data[0]!;
    await svc.markAsRead(first.id, USER_A);
    const unread = await svc.listNotifications(USER_A, { onlyUnread: true });
    expect(unread.data.every((n) => n.readAt === null)).toBe(true);
    expect(unread.data).toHaveLength(4);
  });

  it('does NOT leak other users notifications', async () => {
    await svc.createNotification({
      userId: USER_B.id,
      kind: 'ISSUE_COMMENTED',
      payload: { issueKey: 'B-1' },
    });
    const page = await svc.listNotifications(USER_A, {});
    expect(page.data.every((n) => n.userId === USER_A.id)).toBe(true);
  });
});

describe('notificationService.markAsRead', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createNotificationService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    svc = createNotificationService({ prisma: prisma as never });
  });

  it('marks a notification read for owner', async () => {
    const n = await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_ASSIGNED',
      payload: {},
    });
    const r = await svc.markAsRead(n!.id, USER_A);
    expect(r.readAt).not.toBeNull();
  });

  it('rejects non-owner with forbidden', async () => {
    const n = await svc.createNotification({
      userId: USER_A.id,
      kind: 'ISSUE_ASSIGNED',
      payload: {},
    });
    await expect(svc.markAsRead(n!.id, USER_B)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('throws not_found when missing', async () => {
    await expect(svc.markAsRead('ghost', USER_A)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('notificationService.markAllRead', () => {
  it('marks every unread notification for the actor', async () => {
    const prisma = createFakePrisma();
    const svc = createNotificationService({ prisma: prisma as never });
    for (let i = 0; i < 3; i++) {
      await svc.createNotification({
        userId: USER_A.id,
        kind: 'ISSUE_COMMENTED',
        payload: { issueKey: `P-${i}` },
      });
    }
    const { count } = await svc.markAllRead(USER_A);
    expect(count).toBe(3);
    const unread = await svc.listNotifications(USER_A, { onlyUnread: true });
    expect(unread.data).toHaveLength(0);
  });
});

describe('notificationService.preferences', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createNotificationService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    svc = createNotificationService({ prisma: prisma as never });
  });

  it('returns a full matrix defaulting to enabled when no rows exist', async () => {
    const prefs = await svc.getPreferences(USER_A);
    expect(prefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ISSUE_ASSIGNED', channel: 'IN_APP', enabled: true }),
        expect.objectContaining({ kind: 'ISSUE_MENTIONED', channel: 'EMAIL', enabled: true }),
      ]),
    );
    // 7 kinds × 2 channels = 14
    expect(prefs).toHaveLength(14);
  });

  it('reflects user overrides', async () => {
    await svc.updatePreference(
      { kind: 'ISSUE_COMMENTED', channel: 'EMAIL', enabled: false },
      USER_A,
    );
    const prefs = await svc.getPreferences(USER_A);
    const overridden = prefs.find((p) => p.kind === 'ISSUE_COMMENTED' && p.channel === 'EMAIL');
    expect(overridden?.enabled).toBe(false);
  });
});
