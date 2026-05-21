// End-to-end lifecycle of a sprint via real route handlers + real Postgres.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedUsersAndProject,
  startSprintsIntegrationContext,
  stopSprintsIntegrationContext,
  withSession,
  type SprintsIntegrationContext,
  type TestUsers,
} from './__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('sprints lifecycle via routes', () => {
  let ctx: SprintsIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startSprintsIntegrationContext();
    u = await seedUsersAndProject('SPNL');
  }, 240_000);

  afterAll(async () => {
    await stopSprintsIntegrationContext(ctx);
  });

  async function createIssue(title: string): Promise<string> {
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request(`http://localhost/api/projects/${u.projectKey}/issues`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: u.projectKey }) },
      );
    });
    if (!res.ok) throw new Error(`create issue failed: ${res.status}`);
    const { issue } = (await res.json()) as { issue: { key: string } };
    return issue.key;
  }

  it('create → add issues → start → transition one → complete', async () => {
    // Create sprint
    const sprintRes = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/sprints/route');
      return POST(
        new Request(`http://localhost/api/projects/${u.projectKey}/sprints`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Sprint 1', goal: 'Ship MVP' }),
        }),
        { params: Promise.resolve({ key: u.projectKey }) },
      );
    });
    expect(sprintRes.status).toBe(201);
    const { sprint } = (await sprintRes.json()) as { sprint: { id: string; state: string } };
    expect(sprint.state).toBe('PLANNED');

    // Two issues
    const k1 = await createIssue('First');
    const k2 = await createIssue('Second');

    // Add both
    for (const key of [k1, k2]) {
      const r = await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/sprints/[id]/issues/route');
        return POST(
          new Request(`http://localhost/api/sprints/${sprint.id}/issues`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ issueKey: key }),
          }),
          { params: Promise.resolve({ id: sprint.id }) },
        );
      });
      expect(r.status).toBe(201);
    }

    // Start
    const startRes = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/sprints/[id]/start/route');
      return POST(
        new Request(`http://localhost/api/sprints/${sprint.id}/start`, {
          method: 'POST',
        }),
        { params: Promise.resolve({ id: sprint.id }) },
      );
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { sprint: { state: string } };
    expect(startBody.sprint.state).toBe('ACTIVE');

    // Transition first issue to DONE: TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
    for (const target of ['IN_PROGRESS', 'IN_REVIEW', 'DONE']) {
      const r = await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/issues/[issueKey]/transition/route');
        return POST(
          new Request(`http://localhost/api/issues/${k1}/transition`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: target }),
          }),
          { params: Promise.resolve({ issueKey: k1 }) },
        );
      });
      expect(r.status, `transition to ${target}`).toBe(200);
    }

    // Complete the sprint
    const completeRes = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/sprints/[id]/complete/route');
      return POST(
        new Request(`http://localhost/api/sprints/${sprint.id}/complete`, {
          method: 'POST',
        }),
        { params: Promise.resolve({ id: sprint.id }) },
      );
    });
    expect(completeRes.status).toBe(200);
    const completed = (await completeRes.json()) as { sprint: { state: string } };
    expect(completed.sprint.state).toBe('COMPLETED');

    // Burndown endpoint returns data
    const burn = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/sprints/[id]/burndown/route');
      return GET(new Request(`http://localhost/api/sprints/${sprint.id}/burndown`), {
        params: Promise.resolve({ id: sprint.id }),
      });
    });
    expect(burn.status).toBe(200);
    const series = (await burn.json()) as { series: Array<{ date: string; remaining: number }> };
    expect(Array.isArray(series.series)).toBe(true);

    // SprintIssue rows: k1 is DONE so it stays; k2 was moved back.
    const { prisma } = await import('@/server/db');
    const remaining = await prisma.sprintIssue.findMany({ where: { sprintId: sprint.id } });
    expect(remaining).toHaveLength(1);
    const remainingIssue = await prisma.issue.findUnique({
      where: { id: remaining[0]!.issueId },
    });
    expect(remainingIssue?.key).toBe(k1);
  });
});
