// Integration test for Phase 4c — notifications.
//
// Boots a real Postgres via Testcontainers, registers the notification
// subscribers via the test fixture, exercises the existing issue-comment
// route (so the issues service emits issue.mentioned on the bus), and
// then asserts the GET /api/notifications endpoint returns the row.
//
// pg-boss is stubbed via __setJobsClientForTesting — we only assert that
// `send` was invoked when EMAIL preference allows it.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from '../issues/__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('notifications integration', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;
  let issueKey: string;
  let jobsStub: {
    start: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    work: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    createQueue: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('INTF');

    // Wire subscribers exactly like src/server/bootstrap.ts would.
    const { prisma } = await import('@/server/db');
    const { createNotificationService } = await import('@/server/services/notifications');
    const { registerNotificationSubscribers } =
      await import('@/server/services/notifications/subscribers');
    const { reset } = await import('@/server/events/bus');
    reset();

    jobsStub = {
      start: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue('job_1'),
      work: vi.fn().mockResolvedValue('w_1'),
      stop: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      createQueue: vi.fn().mockResolvedValue(undefined),
    };
    const queueMod = await import('@/server/jobs/queue');
    queueMod.__setJobsClientForTesting(jobsStub as never);

    const svc = createNotificationService({
      prisma,
      enqueueEmail: async (job) => {
        await queueMod.enqueueEmailNotification(job);
      },
    });
    registerNotificationSubscribers({
      service: svc,
      lookupIssue: async (issueId) =>
        prisma.issue
          .findUnique({
            where: { id: issueId },
            select: { reporterId: true, assigneeId: true },
          })
          .then((r) => r ?? null),
    });

    // Create an issue (lead is reporter).
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request('http://localhost/api/projects/INTF/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'notifme', type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: 'INTF' }) },
      );
    });
    const { issue } = (await res.json()) as { issue: { key: string } };
    issueKey = issue.key;
  }, 240_000);

  beforeEach(() => {
    jobsStub.send.mockClear();
  });

  afterAll(async () => {
    const { __resetJobsForTesting } = await import('@/server/jobs/queue');
    __resetJobsForTesting();
    const { __resetNotificationSubscribers } =
      await import('@/server/services/notifications/subscribers');
    __resetNotificationSubscribers();
    await stopIssuesIntegrationContext(ctx);
    vi.restoreAllMocks();
  });

  it('@mention through the comments route lands in /api/notifications', async () => {
    // lead mentions member; the projects setup registers member with email
    // local-part `member.intf`.
    await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/comments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'heads up @member.intf' }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });

    // Subscribers are fire-and-forget — give microtasks a chance to flush.
    await new Promise((r) => setTimeout(r, 50));

    const res = await withSession(u.memberId, async () => {
      const { GET } = await import('@/../app/api/notifications/route');
      return GET(new Request('http://localhost/api/notifications'));
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ kind: string; payload: { issueKey?: string } }>;
      unreadCount: number;
    };
    const mentioned = body.data.find((n) => n.kind === 'ISSUE_MENTIONED');
    expect(mentioned).toBeDefined();
    expect(mentioned?.payload.issueKey).toBe(issueKey);
    expect(body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('email queue receives a job when EMAIL preference is on (default)', async () => {
    // Default prefs are enabled → enqueue should fire when the @mention
    // triggers the subscriber. Reuse the same setup; verify after another
    // mention.
    await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/comments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'ping again @member.intf' }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(jobsStub.send).toHaveBeenCalled();
    const lastCall = jobsStub.send.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('email-notification');
    expect(lastCall?.[1]).toMatchObject({ kind: 'ISSUE_MENTIONED' });
  });

  it('preferences PATCH disables EMAIL and suppresses the queue job', async () => {
    await withSession(u.memberId, async () => {
      const { PATCH } = await import('@/../app/api/notifications/preferences/route');
      return PATCH(
        new Request('http://localhost/api/notifications/preferences', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'ISSUE_MENTIONED',
            channel: 'EMAIL',
            enabled: false,
          }),
        }),
      );
    });
    jobsStub.send.mockClear();

    await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/comments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'silent ping @member.intf' }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(jobsStub.send).not.toHaveBeenCalled();
  });

  it('POST /api/notifications/[id]/read marks one, read-all clears the rest', async () => {
    // Read the current list, mark first one, then mark-all.
    const list1 = await withSession(u.memberId, async () => {
      const { GET } = await import('@/../app/api/notifications/route');
      return GET(new Request('http://localhost/api/notifications'));
    });
    const body1 = (await list1.json()) as { data: Array<{ id: string }>; unreadCount: number };
    const first = body1.data[0];
    expect(first).toBeDefined();

    const readOne = await withSession(u.memberId, async () => {
      const { POST } = await import('@/../app/api/notifications/[id]/read/route');
      return POST(new Request('http://localhost', { method: 'POST' }), {
        params: Promise.resolve({ id: first!.id }),
      });
    });
    expect(readOne.status).toBe(200);

    const readAll = await withSession(u.memberId, async () => {
      const { POST } = await import('@/../app/api/notifications/read-all/route');
      return POST();
    });
    expect(readAll.status).toBe(200);

    const list2 = await withSession(u.memberId, async () => {
      const { GET } = await import('@/../app/api/notifications/route');
      return GET(new Request('http://localhost/api/notifications?onlyUnread=1'));
    });
    const body2 = (await list2.json()) as { data: unknown[]; unreadCount: number };
    expect(body2.unreadCount).toBe(0);
    expect(body2.data).toHaveLength(0);
  });
});
