import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSprintsService } from '@/server/services/sprints';
import { on, reset } from '@/server/events/bus';
import { SPRINT_EVENTS } from '@/server/events/sprintTypes';
import { createFakePrisma, seedSprintScaffolding, type FakePrisma } from './__support__/fakePrisma';

describe('sprints.createSprint', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  it('LEAD can create a sprint that defaults to PLANNED', async () => {
    const s = await svc.createSprint(
      { projectKey: 'SPR', name: 'Sprint 1', goal: 'Ship MVP' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(s.name).toBe('Sprint 1');
    expect(s.goal).toBe('Ship MVP');
    expect(s.state).toBe('PLANNED');
    expect(s.startDate).toBeNull();
    expect(s.endDate).toBeNull();
    expect(s.projectId).toBe(scaff.project.id);
  });

  it('MEMBER cannot create a sprint', async () => {
    await expect(
      svc.createSprint({ projectKey: 'SPR', name: 'X' }, { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('outsider gets forbidden', async () => {
    await expect(
      svc.createSprint({ projectKey: 'SPR', name: 'X' }, { id: scaff.outsider.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects unknown project', async () => {
    await expect(
      svc.createSprint({ projectKey: 'NOPE', name: 'X' }, { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects empty name', async () => {
    await expect(
      svc.createSprint({ projectKey: 'SPR', name: '' }, { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('emits sprint.created', async () => {
    const handler = vi.fn();
    on(SPRINT_EVENTS.CREATED, handler);
    await svc.createSprint({ projectKey: 'SPR', name: 'S' }, { id: scaff.lead.id, role: 'LEAD' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ name: 'S', state: 'PLANNED' });
  });
});
