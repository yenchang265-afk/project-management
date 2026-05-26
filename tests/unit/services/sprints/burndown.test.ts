import { beforeEach, describe, expect, it } from 'vitest';

import { createSprintsService } from '@/server/services/sprints';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedSprintScaffolding,
  seedIssue,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('sprints.getBurndown', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  it('returns daily remaining counts driven by status transitions', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const i1 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1, 'TODO', 'SPR-1');
    const i2 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 2, 'TODO', 'SPR-2');
    const i3 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 3, 'TODO', 'SPR-3');
    for (const i of [i1, i2, i3]) {
      await svc.addIssueToSprint(
        { sprintId: sprint.id, issueKey: i.key },
        { id: scaff.lead.id, role: 'LEAD' },
      );
    }
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-03T00:00:00Z');
    await svc.startSprint(
      sprint.id,
      { startDate: start, endDate: end },
      { id: scaff.lead.id, role: 'LEAD' },
    );

    // Seed activity log: i1 -> DONE on day 1, i2 -> DONE on day 2, i3 stays TODO.
    await prisma.activityLogEntry.create({
      data: {
        issueId: i1.id,
        actorId: scaff.lead.id,
        field: 'status',
        before: 'TODO',
        after: 'DONE',
        at: new Date('2026-05-01T12:00:00Z'),
      },
    });
    await prisma.activityLogEntry.create({
      data: {
        issueId: i2.id,
        actorId: scaff.lead.id,
        field: 'status',
        before: 'TODO',
        after: 'DONE',
        at: new Date('2026-05-02T15:00:00Z'),
      },
    });

    const burndown = await svc.getBurndown(sprint.id, { id: scaff.lead.id, role: 'LEAD' });
    expect(burndown).toHaveLength(3);
    expect(burndown[0]!.remaining).toBe(2); // EOD May 1: i1 done -> 2 left
    expect(burndown[1]!.remaining).toBe(1); // EOD May 2: i1+i2 done -> 1 left
    expect(burndown[2]!.remaining).toBe(1); // EOD May 3: no new transition -> still 1
    expect(burndown[0]!.date.slice(0, 10)).toBe('2026-05-01');
  });

  it('VIEWER (project member) can read burndown', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.startSprint(
      sprint.id,
      {
        startDate: new Date('2026-05-01T00:00:00Z'),
        endDate: new Date('2026-05-02T00:00:00Z'),
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    // member is part of the project; should be allowed
    const series = await svc.getBurndown(sprint.id, { id: scaff.member.id, role: 'MEMBER' });
    expect(Array.isArray(series)).toBe(true);
  });
});
