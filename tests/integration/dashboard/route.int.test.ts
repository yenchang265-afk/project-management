// Integration test for GET /api/dashboard. Boots Postgres + applies
// migrations via the shared Phase 3 Testcontainers setup, then exercises
// the route handler with a stubbed session.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from '../issues/__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('GET /api/dashboard', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('IDSH');
    // Create one issue assigned to the lead (so assignedToMe is non-empty)
    // and transition it so an activity entry exists.
    await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      const r = await POST(
        new Request('http://localhost/api/projects/IDSH/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'on my plate', type: 'TASK', assigneeId: u.leadId }),
        }),
        { params: Promise.resolve({ key: 'IDSH' }) },
      );
      if (!r.ok) throw new Error(`create issue failed: ${r.status}`);
      const { issue } = (await r.json()) as { issue: { key: string } };
      const { POST: transition } = await import(
        '@/../app/api/issues/[issueKey]/transition/route'
      );
      const tr = await transition(
        new Request(`http://localhost/api/issues/${issue.key}/transition`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: 'IN_PROGRESS' }),
        }),
        { params: Promise.resolve({ issueKey: issue.key }) },
      );
      if (!tr.ok) throw new Error(`transition failed: ${tr.status}`);
    });
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
    vi.restoreAllMocks();
  });

  it('returns 401 for anonymous callers', async () => {
    const res = await withSession(null, async () => {
      const { GET } = await import('@/../app/api/dashboard/route');
      return GET(new Request('http://localhost/api/dashboard'));
    });
    expect(res.status).toBe(401);
  });

  it('returns the three sections for a logged-in lead', async () => {
    const res = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/dashboard/route');
      return GET(new Request('http://localhost/api/dashboard'));
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignedToMe: Array<{ key: string; title: string }>;
      recentActivity: Array<{ field: string; issueKey: string }>;
      projectTiles: Array<{ key: string; openIssues: number }>;
    };
    expect(body.assignedToMe.length).toBeGreaterThan(0);
    expect(body.assignedToMe.some((i) => i.title === 'on my plate')).toBe(true);
    expect(body.recentActivity.length).toBeGreaterThan(0);
    expect(body.projectTiles.map((t) => t.key)).toContain('IDSH');
    const tile = body.projectTiles.find((t) => t.key === 'IDSH');
    expect(tile?.openIssues).toBeGreaterThanOrEqual(1);
  });
});
