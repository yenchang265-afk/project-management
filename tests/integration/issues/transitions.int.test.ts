import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from './__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('issue transitions via routes', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;
  let issueKey: string;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('ITRA');
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request('http://localhost/api/projects/ITRA/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'flow', type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: 'ITRA' }) },
      );
    });
    const { issue } = (await res.json()) as { issue: { key: string } };
    issueKey = issue.key;
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  async function transition(to: string, asUser = u.leadId) {
    return withSession(asUser, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/transition/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/transition`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
  }

  it('walks TODO → IN_PROGRESS → IN_REVIEW → DONE', async () => {
    expect((await transition('IN_PROGRESS')).status).toBe(200);
    expect((await transition('IN_REVIEW')).status).toBe(200);
    expect((await transition('DONE')).status).toBe(200);
  });

  it('rejects illegal transition (DONE → IN_REVIEW) with 422', async () => {
    const res = await transition('IN_REVIEW');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_transition');
  });

  it('allows reopen (DONE → TODO)', async () => {
    expect((await transition('TODO')).status).toBe(200);
  });
});
