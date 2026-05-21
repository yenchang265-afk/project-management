import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueStatus } from '@prisma/client';

import { createIssuesService, isAllowedTransition } from '@/server/services/issues';
import { on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.transitionIssue', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('allows TODO → IN_PROGRESS → IN_REVIEW → DONE', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'flow', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const steps: IssueStatus[] = ['IN_PROGRESS', 'IN_REVIEW', 'DONE'];
    for (const s of steps) {
      const after = await svc.transitionIssue(i.key, s, { id: scaff.lead.id, role: 'LEAD' });
      expect(after.status).toBe(s);
    }
  });

  it('emits issue.transitioned with from/to', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.TRANSITIONED, handler);
    await svc.transitionIssue(i.key, 'IN_PROGRESS', { id: scaff.lead.id, role: 'LEAD' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ from: 'TODO', to: 'IN_PROGRESS' });
  });

  it('rejects disallowed transitions (TODO → DONE)', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.transitionIssue(i.key, 'DONE', { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('allows reopen (DONE → TODO)', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.transitionIssue(i.key, 'IN_PROGRESS', { id: scaff.lead.id, role: 'LEAD' });
    await svc.transitionIssue(i.key, 'IN_REVIEW', { id: scaff.lead.id, role: 'LEAD' });
    await svc.transitionIssue(i.key, 'DONE', { id: scaff.lead.id, role: 'LEAD' });
    const reopened = await svc.transitionIssue(i.key, 'TODO', {
      id: scaff.lead.id,
      role: 'LEAD',
    });
    expect(reopened.status).toBe('TODO');
  });

  it('no-op when newStatus == current', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.TRANSITIONED, handler);
    const same = await svc.transitionIssue(i.key, 'TODO', { id: scaff.lead.id, role: 'LEAD' });
    expect(same.status).toBe('TODO');
    expect(handler).not.toHaveBeenCalled();
  });

  it('writes activity entry on transition', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.transitionIssue(i.key, 'IN_PROGRESS', { id: scaff.lead.id, role: 'LEAD' });
    const log = await prisma.activityLogEntry.findMany({ where: { issueId: i.id } });
    const tr = log.find((e) => e.field === 'status');
    expect(tr?.before).toBe('TODO');
    expect(tr?.after).toBe('IN_PROGRESS');
  });

  it('isAllowedTransition matrix sanity', () => {
    expect(isAllowedTransition('TODO', 'IN_PROGRESS')).toBe(true);
    expect(isAllowedTransition('IN_PROGRESS', 'IN_REVIEW')).toBe(true);
    expect(isAllowedTransition('IN_REVIEW', 'DONE')).toBe(true);
    expect(isAllowedTransition('DONE', 'TODO')).toBe(true);
    expect(isAllowedTransition('IN_PROGRESS', 'TODO')).toBe(true);
    expect(isAllowedTransition('IN_REVIEW', 'IN_PROGRESS')).toBe(true);
    expect(isAllowedTransition('TODO', 'DONE')).toBe(false);
    expect(isAllowedTransition('TODO', 'IN_REVIEW')).toBe(false);
    expect(isAllowedTransition('DONE', 'IN_REVIEW')).toBe(false);
    expect(isAllowedTransition('DONE', 'IN_PROGRESS')).toBe(false);
  });
});
