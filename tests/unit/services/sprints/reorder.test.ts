import { beforeEach, describe, expect, it } from 'vitest';

import { createSprintsService, REBALANCE_GAP } from '@/server/services/sprints';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedSprintScaffolding,
  seedIssue,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('sprints.reorderSprintIssue', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  async function setup3() {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const a = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1, 'TODO', 'SPR-1');
    const b = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 2, 'TODO', 'SPR-2');
    const c = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 3, 'TODO', 'SPR-3');
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: a.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: b.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: c.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    return { sprint, a, b, c };
  }

  it('moves issue to the top when beforeIssueKey is the current first', async () => {
    const { sprint, a, c } = await setup3();
    // Move c to be before a
    await svc.reorderSprintIssue(
      { sprintId: sprint.id, issueKey: c.key, beforeIssueKey: a.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const rows = await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    });
    expect(rows.map((r) => r.issueId)).toEqual([c.id, a.id, expect.any(String)]);
    expect(rows[0]!.rank).toBeLessThan(rows[1]!.rank);
  });

  it('moves issue to the bottom when no beforeIssueKey', async () => {
    const { sprint, a } = await setup3();
    await svc.reorderSprintIssue(
      { sprintId: sprint.id, issueKey: a.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const rows = await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    });
    // a should be last
    expect(rows[rows.length - 1]!.issueId).toBe(a.id);
  });

  it('puts issue between two neighbors (midpoint)', async () => {
    const { sprint, a, b, c } = await setup3();
    // Initial: a=1024, b=2048, c=3072
    // Move c between a and b → before key = b → mid(1024, 2048) = 1536
    await svc.reorderSprintIssue(
      { sprintId: sprint.id, issueKey: c.key, beforeIssueKey: b.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const rows = await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    });
    expect(rows.map((r) => r.issueId)).toEqual([a.id, c.id, b.id]);
  });

  it('rebalances ranks when neighbors collide too tightly', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const a = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1, 'TODO', 'SPR-1');
    const b = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 2, 'TODO', 'SPR-2');
    const c = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 3, 'TODO', 'SPR-3');
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: a.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: b.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: c.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    // Force-collapse ranks of a, b to 0,1 (tightly packed) by directly mutating
    // the underlying store so we can deterministically trigger a rebalance.
    await prisma.sprintIssue.update({
      where: { sprintId_issueId: { sprintId: sprint.id, issueId: a.id } },
      data: { rank: 0 },
    });
    await prisma.sprintIssue.update({
      where: { sprintId_issueId: { sprintId: sprint.id, issueId: b.id } },
      data: { rank: 1 },
    });

    // Try to insert c between a and b — midpoint = 0; collision should trigger rebalance.
    await svc.reorderSprintIssue(
      { sprintId: sprint.id, issueKey: c.key, beforeIssueKey: b.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );

    const rows = await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    });
    expect(rows.map((r) => r.issueId)).toEqual([a.id, c.id, b.id]);
    // After rebalance (a=REBALANCE_GAP, b=2*REBALANCE_GAP) plus reinsert of c
    // between them, c should sit at the midpoint.
    expect(rows[0]!.rank).toBe(REBALANCE_GAP);
    expect(rows[2]!.rank).toBe(2 * REBALANCE_GAP);
    expect(rows[1]!.rank).toBeGreaterThan(rows[0]!.rank);
    expect(rows[1]!.rank).toBeLessThan(rows[2]!.rank);
  });
});
