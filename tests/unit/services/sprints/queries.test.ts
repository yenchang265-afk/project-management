import { beforeEach, describe, expect, it } from 'vitest';

import { createSprintsService } from '@/server/services/sprints';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedSprintScaffolding,
  seedIssue,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('sprints.listSprints + getActiveSprint', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  it('listSprints returns all sprints for VIEWER+ on project', async () => {
    await svc.createSprint({ projectKey: 'SPR', name: 'A' }, { id: scaff.lead.id, role: 'LEAD' });
    await svc.createSprint({ projectKey: 'SPR', name: 'B' }, { id: scaff.lead.id, role: 'LEAD' });
    const list = await svc.listSprints('SPR', { id: scaff.member.id, role: 'MEMBER' });
    expect(list).toHaveLength(2);
  });

  it('outsider cannot list', async () => {
    await expect(
      svc.listSprints('SPR', { id: scaff.outsider.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('getActiveSprint returns active sprint with issues grouped by status', async () => {
    const sprint = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const i1 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 1, 'TODO', 'SPR-1');
    const i2 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 2, 'IN_PROGRESS', 'SPR-2');
    const i3 = await seedIssue(prisma, scaff.project.id, scaff.lead.id, 3, 'DONE', 'SPR-3');
    for (const i of [i1, i2, i3]) {
      await svc.addIssueToSprint(
        { sprintId: sprint.id, issueKey: i.key },
        { id: scaff.lead.id, role: 'LEAD' },
      );
    }
    await svc.startSprint(sprint.id, {}, { id: scaff.lead.id, role: 'LEAD' });

    const active = await svc.getActiveSprint('SPR', { id: scaff.member.id, role: 'MEMBER' });
    expect(active).not.toBeNull();
    expect(active!.sprint.id).toBe(sprint.id);
    expect(active!.columns.TODO.map((i) => i.id)).toEqual([i1.id]);
    expect(active!.columns.IN_PROGRESS.map((i) => i.id)).toEqual([i2.id]);
    expect(active!.columns.DONE.map((i) => i.id)).toEqual([i3.id]);
  });

  it('getActiveSprint returns null when no active sprint', async () => {
    const active = await svc.getActiveSprint('SPR', { id: scaff.member.id, role: 'MEMBER' });
    expect(active).toBeNull();
  });
});
