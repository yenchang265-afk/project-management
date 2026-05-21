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

describe('sprints.addIssueToSprint / removeIssueFromSprint', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  async function makeSprint() {
    return svc.createSprint({ projectKey: 'SPR', name: 'S1' }, { id: scaff.lead.id, role: 'LEAD' });
  }

  it('MEMBER can add an issue and rank is assigned (max+1024)', async () => {
    const sprint = await makeSprint();
    const i1 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1);
    const handler = vi.fn();
    on(SPRINT_EVENTS.ISSUE_ADDED, handler);

    const link = await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: i1.key },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    expect(link.sprintId).toBe(sprint.id);
    expect(link.issueId).toBe(i1.id);
    expect(link.rank).toBe(1024); // 0 + 1024

    const i2 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 2);
    const link2 = await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: i2.key },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    expect(link2.rank).toBe(2048);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('outsider gets forbidden', async () => {
    const sprint = await makeSprint();
    const i1 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1);
    await expect(
      svc.addIssueToSprint(
        { sprintId: sprint.id, issueKey: i1.key },
        { id: scaff.outsider.id, role: 'MEMBER' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects an issue already in another sprint of the same project', async () => {
    const a = await makeSprint();
    const b = await svc.createSprint(
      { projectKey: 'SPR', name: 'S2' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const issue = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1);
    await svc.addIssueToSprint(
      { sprintId: a.id, issueKey: issue.key },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.addIssueToSprint(
        { sprintId: b.id, issueKey: issue.key },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects cross-project issue', async () => {
    const sprint = await makeSprint();
    const otherProject = await prisma.project.create({
      data: { key: 'OTHR', name: 'Other', leadId: scaff.lead.id },
    });
    await prisma.projectMember.create({
      data: { projectId: otherProject.id, userId: scaff.lead.id, role: 'LEAD' },
    });
    const issue = await seedIssue(prisma, otherProject.id, scaff.lead.id, 1, 'TODO', 'OTHR-1');
    await expect(
      svc.addIssueToSprint(
        { sprintId: sprint.id, issueKey: issue.key },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('removeIssueFromSprint removes the row (MEMBER+)', async () => {
    const sprint = await makeSprint();
    const i = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1);
    await svc.addIssueToSprint(
      { sprintId: sprint.id, issueKey: i.key },
      { id: scaff.member.id, role: 'MEMBER' },
    );

    const handler = vi.fn();
    on(SPRINT_EVENTS.ISSUE_REMOVED, handler);
    await svc.removeIssueFromSprint(
      { sprintId: sprint.id, issueKey: i.key },
      { id: scaff.member.id, role: 'MEMBER' },
    );

    const rows = await prisma.sprintIssue.findMany({ where: { sprintId: sprint.id } });
    expect(rows).toHaveLength(0);
    expect(handler).toHaveBeenCalledOnce();
  });
});
