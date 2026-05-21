import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSprintsService } from '@/server/services/sprints';
import { on, reset } from '@/server/events/bus';
import { SPRINT_EVENTS } from '@/server/events/sprintTypes';
import { createFakePrisma, seedSprintScaffolding, type FakePrisma } from './__support__/fakePrisma';

describe('sprints.startSprint', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSprintsService>;
  let scaff: Awaited<ReturnType<typeof seedSprintScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createSprintsService({ prisma: prisma as never });
    scaff = await seedSprintScaffolding(prisma);
  });

  it('LEAD starts a planned sprint; sets ACTIVE and defaults startDate to now', async () => {
    const s = await svc.createSprint(
      { projectKey: 'SPR', name: 'S1' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(SPRINT_EVENTS.STARTED, handler);
    const started = await svc.startSprint(s.id, {}, { id: scaff.lead.id, role: 'LEAD' });
    expect(started.state).toBe('ACTIVE');
    expect(started.startDate).toBeInstanceOf(Date);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects starting a second sprint while one is active', async () => {
    const a = await svc.createSprint(
      { projectKey: 'SPR', name: 'A' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const b = await svc.createSprint(
      { projectKey: 'SPR', name: 'B' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.startSprint(a.id, {}, { id: scaff.lead.id, role: 'LEAD' });
    await expect(
      svc.startSprint(b.id, {}, { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('MEMBER cannot start a sprint', async () => {
    const s = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.startSprint(s.id, {}, { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('honors explicit startDate/endDate', async () => {
    const s = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-15T00:00:00Z');
    const started = await svc.startSprint(
      s.id,
      { startDate: start, endDate: end },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(started.startDate?.toISOString()).toBe(start.toISOString());
    expect(started.endDate?.toISOString()).toBe(end.toISOString());
  });

  it('does not double-start an already-active sprint', async () => {
    const s = await svc.createSprint(
      { projectKey: 'SPR', name: 'S' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.startSprint(s.id, {}, { id: scaff.lead.id, role: 'LEAD' });
    await expect(
      svc.startSprint(s.id, {}, { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
