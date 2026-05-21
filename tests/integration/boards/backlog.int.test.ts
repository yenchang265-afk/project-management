// Phase 4a — Backlog pagination.

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

describe.skipIf(!dockerAvailable)('backlog route', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('BCK');
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('paginates TODO issues', async () => {
    for (let i = 0; i < 5; i++) {
      await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/projects/[key]/issues/route');
        await POST(
          new Request('http://localhost/api/projects/BCK/issues', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: `back ${i}`, type: 'TASK' }),
          }),
          { params: Promise.resolve({ key: 'BCK' }) },
        );
      });
    }
    const page1 = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/projects/[key]/backlog/route');
      return GET(new Request('http://localhost/api/projects/BCK/backlog?limit=2'), {
        params: Promise.resolve({ key: 'BCK' }),
      });
    });
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      data: Array<{ id: string }>;
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    };
    expect(body1.data).toHaveLength(2);
    expect(body1.pageInfo.hasMore).toBe(true);

    const page2 = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/projects/[key]/backlog/route');
      return GET(
        new Request(
          `http://localhost/api/projects/BCK/backlog?limit=2&cursor=${body1.pageInfo.nextCursor}`,
        ),
        { params: Promise.resolve({ key: 'BCK' }) },
      );
    });
    expect(page2.status).toBe(200);
    const body2 = (await page2.json()) as { data: Array<{ id: string }> };
    expect(body2.data).toHaveLength(2);
    // No overlap
    const ids = new Set([...body1.data.map((d) => d.id), ...body2.data.map((d) => d.id)]);
    expect(ids.size).toBe(4);
  });
});
