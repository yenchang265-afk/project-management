import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSprintsService } from '@/server/services/sprints';
import { on, reset } from '@/server/events/bus';
import { SPRINT_EVENTS } from '@/server/events/sprintTypes';
import {
  createFakePrisma,
  seedSprintScaffolding,
  seedIssue,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('sprints.completeSprint', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  it('moves incomplete issues back to backlog and marks COMPLETED', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const done = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1, 'DONE', 'SPR-1');
    const inProg = await seedIssue(
      prisma,
      scaff.project.id,
      scaff.lead.id,
      2,
      'IN_PROGRESS',
      'SPR-2',
    );
    const todo = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 3, 'TODO', 'SPR-3');
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: done.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: inProg.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: todo.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.startSprint(sprint.id, {}, { id: scaff.lead.id, role: 'LEAD' });

    const handler = vi.fn();
    on(SPRINT_EVENTS.COMPLETED, handler);

    const completed = await svc.completeSprint(sprint.id, { id: scaff.lead.id, role: 'LEAD' });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.completedAt).toBeInstanceOf(Date);

    const rows = await prisma.sprintIssue.findMany({ where: { sprintId: sprint.id } });
    // Only the DONE issue stays; the others are moved back (rows deleted).
    expect(rows).toHaveLength(1);
    expect(rows[0]!.issueId).toBe(done.id);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ sprintId: sprint.id });
    expect(handler.mock.calls[0]![0].movedBackIssueIds.sort()).toEqual([inProg.id, todo.id].sort());
  });

  it('MEMBER cannot complete', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.startSprint(sprint.id, {}, { id: scaff.lead.id, role: 'LEAD' });
    await expect(
      svc.completeSprint(sprint.id, { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects completing a PLANNED sprint', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.completeSprint(sprint.id, { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
