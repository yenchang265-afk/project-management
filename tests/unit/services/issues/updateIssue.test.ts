import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.updateIssue', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('updates allowed fields and emits one event per changed field', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'orig', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.UPDATED, handler);
    const updated = await svc.updateIssue(
      issue.key,
      { title: 'new', priority: 'HIGH' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(updated.title).toBe('new');
    expect(updated.priority).toBe('HIGH');
    expect(handler).toHaveBeenCalledTimes(2);
    const fields = handler.mock.calls.map((c) => c[0].field).sort();
    expect(fields).toEqual(['priority', 'title']);
  });

  it('records per-field activity log rows', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.updateIssue(
      issue.key,
      { title: 'b', priority: 'HIGH' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const log = await prisma.activityLogEntry.findMany({ where: { issueId: issue.id } });
    const titleEntry = log.find((e) => e.field === 'title');
    expect(titleEntry?.before).toBe('a');
    expect(titleEntry?.after).toBe('b');
  });

  it('no-op when nothing changed (no event, no activity)', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.UPDATED, handler);
    const before = await prisma.activityLogEntry.findMany({ where: { issueId: issue.id } });
    await svc.updateIssue(issue.key, { title: 'a' }, { id: scaff.lead.id, role: 'LEAD' });
    const after = await prisma.activityLogEntry.findMany({ where: { issueId: issue.id } });
    expect(after).toHaveLength(before.length);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects unknown fields via strict schema', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.updateIssue(
        issue.key,
        { status: 'DONE' } as unknown as Parameters<typeof svc.updateIssue>[1],
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects assigneeId that is not a project member', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.updateIssue(
        issue.key,
        { assigneeId: scaff.outsider.id },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('forbids non-members', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.updateIssue(issue.key, { title: 'x' }, { id: scaff.outsider.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
