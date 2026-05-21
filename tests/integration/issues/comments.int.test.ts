import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from './__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('issue comments via routes', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;
  let issueKey: string;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('ICOM');
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request('http://localhost/api/projects/ICOM/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'commented', type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: 'ICOM' }) },
      );
    });
    const { issue } = (await res.json()) as { issue: { key: string } };
    issueKey = issue.key;
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
    vi.restoreAllMocks();
  });

  it('member posts a comment, activity log persists', async () => {
    const res = await withSession(u.memberId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/comments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'hello there' }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
    expect(res.status).toBe(201);
    const { prisma } = await import('@/server/db');
    const issue = await prisma.issue.findUnique({ where: { key: issueKey } });
    if (!issue) throw new Error('issue gone');
    const log = await prisma.activityLogEntry.findMany({ where: { issueId: issue.id } });
    expect(log.some((e) => e.field === 'comment.added')).toBe(true);
  });

  it('@mention emits issue.mentioned event', async () => {
    const { on, ISSUE_EVENTS, reset } = await import('@/server/events/types').then(
      async (types) => {
        const bus = await import('@/server/events/bus');
        return { on: bus.on, reset: bus.reset, ISSUE_EVENTS: types.ISSUE_EVENTS };
      },
    );
    reset();
    const handler = vi.fn();
    on(ISSUE_EVENTS.MENTIONED, handler);
    // lead mentions member; member's email local-part is `member.icom`
    await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/comments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'cc @member.icom' }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
    expect(handler).toHaveBeenCalled();
  });
});
