// Full CRUD cycle for issues over real route handlers + real Postgres.

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

describe.skipIf(!dockerAvailable)('issues CRUD via routes', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('ICRUD');
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('LEAD creates → GET → PATCH → DELETE', async () => {
    // create
    const created = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request('http://localhost/api/projects/ICRUD/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'first', type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: 'ICRUD' }) },
      );
    });
    expect(created.status).toBe(201);
    const { issue } = (await created.json()) as { issue: { key: string; id: string } };
    expect(issue.key).toBe('ICRUD-1');

    // get
    const read = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/issues/[issueKey]/route');
      return GET(new Request(`http://localhost/api/issues/${issue.key}`), {
        params: Promise.resolve({ issueKey: issue.key }),
      });
    });
    expect(read.status).toBe(200);

    // patch
    const patched = await withSession(u.leadId, async () => {
      const { PATCH } = await import('@/../app/api/issues/[issueKey]/route');
      return PATCH(
        new Request(`http://localhost/api/issues/${issue.key}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'renamed' }),
        }),
        { params: Promise.resolve({ issueKey: issue.key }) },
      );
    });
    expect(patched.status).toBe(200);

    // delete (LEAD only)
    const deleted = await withSession(u.leadId, async () => {
      const { DELETE } = await import('@/../app/api/issues/[issueKey]/route');
      return DELETE(new Request(`http://localhost/api/issues/${issue.key}`, { method: 'DELETE' }), {
        params: Promise.resolve({ issueKey: issue.key }),
      });
    });
    expect(deleted.status).toBe(204);
  });

  it('MEMBER can create + patch but not delete', async () => {
    const created = await withSession(u.memberId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request('http://localhost/api/projects/ICRUD/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'mem', type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: 'ICRUD' }) },
      );
    });
    expect(created.status).toBe(201);
    const { issue } = (await created.json()) as { issue: { key: string } };

    const deleted = await withSession(u.memberId, async () => {
      const { DELETE } = await import('@/../app/api/issues/[issueKey]/route');
      return DELETE(new Request(`http://localhost/api/issues/${issue.key}`, { method: 'DELETE' }), {
        params: Promise.resolve({ issueKey: issue.key }),
      });
    });
    expect(deleted.status).toBe(403);
  });

  it('outsider gets 403 on list', async () => {
    const res = await withSession(u.outsiderId, async () => {
      const { GET } = await import('@/../app/api/projects/[key]/issues/route');
      return GET(new Request('http://localhost/api/projects/ICRUD/issues'), {
        params: Promise.resolve({ key: 'ICRUD' }),
      });
    });
    expect(res.status).toBe(403);
  });
});
