// Phase 4a — Search FTS integration. This is the test that exercises the
// generated `search_tsv` column + GIN index on real Postgres.

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

describe.skipIf(!dockerAvailable)('search FTS', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('SRCH');

    // Seed 5 issues with distinct titles + descriptions so we can verify
    // ranking and exclusion.
    const seeds = [
      { title: 'login bug crashes app', description: 'reproducible on logout', type: 'BUG' },
      { title: 'document the login flow', description: 'auth UX writeup', type: 'TASK' },
      { title: 'add caching', description: 'unrelated infra', type: 'TASK' },
      { title: 'fix navbar', description: 'mobile only', type: 'BUG' },
      { title: 'login button color', description: 'minor', type: 'TASK' },
    ];
    for (const s of seeds) {
      await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/projects/[key]/issues/route');
        const r = await POST(
          new Request('http://localhost/api/projects/SRCH/issues', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(s),
          }),
          { params: Promise.resolve({ key: 'SRCH' }) },
        );
        expect(r.status).toBe(201);
      });
    }
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('matches "login" against title/description tsvector', async () => {
    const res = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/search/route');
      return GET(new Request('http://localhost/api/search?projectKey=SRCH&q=login'));
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ key: string; title: string }>;
      pageInfo: { hasMore: boolean };
    };
    // Three of the five mention "login" in title; "fix navbar" / "add caching"
    // should not match.
    const titles = body.data.map((d) => d.title);
    expect(titles.some((t) => t.includes('login bug'))).toBe(true);
    expect(titles.some((t) => t.includes('login flow'))).toBe(true);
    expect(titles.some((t) => t.includes('login button'))).toBe(true);
    expect(titles).not.toContain('fix navbar');
    expect(titles).not.toContain('add caching');
  });

  it('paginates ranked results', async () => {
    const page1 = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/search/route');
      return GET(new Request('http://localhost/api/search?projectKey=SRCH&q=login&limit=1'));
    });
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      data: Array<{ id: string }>;
      pageInfo: { hasMore: boolean };
    };
    expect(body1.data).toHaveLength(1);
    expect(body1.pageInfo.hasMore).toBe(true);
  });

  it('empty q with filters lists by listIssues', async () => {
    const res = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/search/route');
      return GET(new Request('http://localhost/api/search?projectKey=SRCH&q=&type=BUG'));
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ type: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((d) => d.type === 'BUG')).toBe(true);
  });

  it('outsider blocked', async () => {
    const res = await withSession(u.outsiderId, async () => {
      const { GET } = await import('@/../app/api/search/route');
      return GET(new Request('http://localhost/api/search?projectKey=SRCH&q=login'));
    });
    expect(res.status).toBe(403);
  });
});
