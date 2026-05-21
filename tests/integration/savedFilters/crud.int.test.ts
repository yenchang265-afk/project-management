// Phase 4a — Saved filters CRUD with auth.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from '../issues/__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('saved filters CRUD', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('SAVE');
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('unauthenticated GET returns 401', async () => {
    const res = await withSession(null, async () => {
      const { GET } = await import('@/../app/api/saved-filters/route');
      return GET(new Request('http://localhost/api/saved-filters'));
    });
    expect(res.status).toBe(401);
  });

  it('owner can create, list, update, delete', async () => {
    // create
    const created = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/saved-filters/route');
      return POST(
        new Request('http://localhost/api/saved-filters', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Open bugs',
            query: { status: ['TODO'], type: ['BUG'] },
          }),
        }),
      );
    });
    expect(created.status).toBe(201);
    const cbody = (await created.json()) as { filter: { id: string; name: string } };
    expect(cbody.filter.name).toBe('Open bugs');

    // list
    const list = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/saved-filters/route');
      return GET(new Request('http://localhost/api/saved-filters'));
    });
    expect(list.status).toBe(200);
    const lbody = (await list.json()) as { data: Array<{ id: string }> };
    expect(lbody.data.map((d) => d.id)).toContain(cbody.filter.id);

    // update
    const upd = await withSession(u.leadId, async () => {
      const { PATCH } = await import('@/../app/api/saved-filters/[id]/route');
      return PATCH(
        new Request(`http://localhost/api/saved-filters/${cbody.filter.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        }),
        { params: Promise.resolve({ id: cbody.filter.id }) },
      );
    });
    expect(upd.status).toBe(200);

    // other user cannot delete
    const denied = await withSession(u.memberId, async () => {
      const { DELETE } = await import('@/../app/api/saved-filters/[id]/route');
      return DELETE(
        new Request(`http://localhost/api/saved-filters/${cbody.filter.id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: cbody.filter.id }) },
      );
    });
    expect(denied.status).toBe(403);

    // owner can delete
    const del = await withSession(u.leadId, async () => {
      const { DELETE } = await import('@/../app/api/saved-filters/[id]/route');
      return DELETE(
        new Request(`http://localhost/api/saved-filters/${cbody.filter.id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: cbody.filter.id }) },
      );
    });
    expect(del.status).toBe(204);
  });
});
