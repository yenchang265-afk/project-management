import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { emit as _emit, on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

// Silence ts unused warning on _emit; we just want side effects of `on`.
void _emit;

describe('issues.createIssue', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('creates an issue with sequential number per project', async () => {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'first', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const b = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'second', type: 'BUG' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(a.number).toBe(1);
    expect(a.key).toBe('ALPHA-1');
    expect(b.number).toBe(2);
    expect(b.key).toBe('ALPHA-2');
    expect(a.reporterId).toBe(scaff.lead.id);
    expect(a.status).toBe('TODO');
    expect(a.priority).toBe('MEDIUM');
  });

  it('emits issue.created', async () => {
    const handler = vi.fn();
    on(ISSUE_EVENTS.CREATED, handler);
    await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({
      issueKey: 'ALPHA-1',
      actorId: scaff.lead.id,
    });
  });

  it('non-member is forbidden', async () => {
    await expect(
      svc.createIssue(
        { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
        { id: scaff.outsider.id, role: 'MEMBER' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects invalid input (missing title)', async () => {
    await expect(
      svc.createIssue(
        { projectKey: 'ALPHA', title: '', type: 'TASK' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects unknown project', async () => {
    await expect(
      svc.createIssue(
        { projectKey: 'GHOST', title: 'x', type: 'TASK' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects assignee that is not a project member', async () => {
    await expect(
      svc.createIssue(
        {
          projectKey: 'ALPHA',
          title: 'x',
          type: 'TASK',
          assigneeId: scaff.outsider.id,
        },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('creates labels on demand and attaches them', async () => {
    const i = await svc.createIssue(
      {
        projectKey: 'ALPHA',
        title: 'with labels',
        type: 'TASK',
        labelNames: ['backend', 'urgent'],
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const labels = await prisma.label.findMany({ where: { projectId: scaff.project.id } });
    expect(labels.map((l) => l.name).sort()).toEqual(['backend', 'urgent']);
    const links = await prisma.issueLabel.findMany({ where: { issueId: i.id } });
    expect(links).toHaveLength(2);
  });

  it('reuses existing labels by name', async () => {
    await svc.createIssue(
      {
        projectKey: 'ALPHA',
        title: 'one',
        type: 'TASK',
        labelNames: ['shared'],
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.createIssue(
      {
        projectKey: 'ALPHA',
        title: 'two',
        type: 'TASK',
        labelNames: ['shared'],
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const labels = await prisma.label.findMany({ where: { projectId: scaff.project.id } });
    expect(labels.filter((l) => l.name === 'shared')).toHaveLength(1);
  });

  it('writes a "created" activity log entry', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const log = await prisma.activityLogEntry.findMany({ where: { issueId: i.id } });
    expect(log[0]?.field).toBe('created');
  });
});
