// Seed 60 issues, paginate with cursor, assert no duplicates and full coverage.

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

describe.skipIf(!dockerAvailable)('issue list pagination', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('IPAG');
    for (let i = 0; i < 60; i++) {
      await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/projects/[key]/issues/route');
        return POST(
          new Request('http://localhost/api/projects/IPAG/issues', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: `i-${i}`, type: 'TASK' }),
          }),
          { params: Promise.resolve({ key: 'IPAG' }) },
        );
      });
    }
  }, 300_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('paginates with cursor without duplicates and covers everything', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const url = new URL('http://localhost/api/projects/IPAG/issues');
      url.searchParams.set('limit', '25');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res: Response = await withSession(u.leadId, async () => {
        const { GET } = await import('@/../app/api/projects/[key]/issues/route');
        return GET(new Request(url), { params: Promise.resolve({ key: 'IPAG' }) });
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ id: string }>;
        pageInfo: { nextCursor: string | null; hasMore: boolean };
      };
      for (const i of body.data) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
      if (!body.pageInfo.hasMore) break;
      cursor = body.pageInfo.nextCursor;
      if (!cursor) break;
    }
    expect(seen.size).toBe(60);
  });
});
