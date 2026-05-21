// Burndown over real data: seed 3 days of status transitions and assert series.

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

describe.skipIf(!dockerAvailable)('burndown series', () => {
  let ctx: SprintsIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startSprintsIntegrationContext();
    u = await seedUsersAndProject('SPNB');
  }, 240_000);

  afterAll(async () => {
    await stopSprintsIntegrationContext(ctx);
  });

  it('counts remaining (not DONE) at end-of-day across the sprint window', async () => {
    const { prisma } = await import('@/server/db');
    const project = await prisma.project.findUnique({ where: { key: u.projectKey } });
    if (!project) throw new Error('project missing');

    // Seed 3 issues
    const keys: string[] = [];
    for (let n = 1; n <= 3; n++) {
      const r = await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/projects/[key]/issues/route');
        return POST(
          new Request(`http://localhost/api/projects/${u.projectKey}/issues`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: `T${n}`, type: 'TASK' }),
          }),
          { params: Promise.resolve({ key: u.projectKey }) },
        );
      });
      const { issue } = (await r.json()) as { issue: { key: string } };
      keys.push(issue.key);
    }

    // Create sprint and add issues
    const sprintRes = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/sprints/route');
      return POST(
        new Request(`http://localhost/api/projects/${u.projectKey}/sprints`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Burn' }),
        }),
        { params: Promise.resolve({ key: u.projectKey }) },
      );
    });
    const { sprint } = (await sprintRes.json()) as { sprint: { id: string } };
    for (const key of keys) {
      await withSession(u.leadId, async () => {
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
    }

    // Backdate the sprint window to span 3 deterministic days and inject status
    // transitions over those days directly in Postgres.
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-03T00:00:00Z');
    await prisma.sprint.update({
      where: { id: sprint.id },
      data: { state: 'ACTIVE', startDate: start, endDate: end },
    });

    const issueRows = await prisma.issue.findMany({ where: { key: { in: keys } } });
    const issueByKey = new Map(issueRows.map((i) => [i.key, i]));
    await prisma.activityLogEntry.create({
      data: {
        issueId: issueByKey.get(keys[0]!)!.id,
        actorId: u.leadId,
        field: 'status',
        before: 'TODO',
        after: 'DONE',
        at: new Date('2026-05-01T12:00:00Z'),
      },
    });
    await prisma.activityLogEntry.create({
      data: {
        issueId: issueByKey.get(keys[1]!)!.id,
        actorId: u.leadId,
        field: 'status',
        before: 'TODO',
        after: 'DONE',
        at: new Date('2026-05-02T15:00:00Z'),
      },
    });

    const res = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/sprints/[id]/burndown/route');
      return GET(new Request(`http://localhost/api/sprints/${sprint.id}/burndown`), {
        params: Promise.resolve({ id: sprint.id }),
      });
    });
    expect(res.status).toBe(200);
    const { series } = (await res.json()) as {
      series: Array<{ date: string; remaining: number }>;
    };
    expect(series).toHaveLength(3);
    expect(series[0]!.remaining).toBe(2);
    expect(series[1]!.remaining).toBe(1);
    expect(series[2]!.remaining).toBe(1);
  });
});
