import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.deleteIssue', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('LEAD can delete and event fires', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'rm', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.DELETED, handler);
    await svc.deleteIssue(i.key, { id: scaff.lead.id, role: 'LEAD' });
    expect(handler).toHaveBeenCalledOnce();
    const stillThere = await prisma.issue.findUnique({ where: { id: i.id } });
    expect(stillThere).toBeNull();
  });

  it('MEMBER cannot delete (forbidden)', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.deleteIssue(i.key, { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('cascades comments, labels, activity, links', async () => {
    const i = await svc.createIssue(
      {
        projectKey: 'ALPHA',
        title: 'parent',
        type: 'TASK',
        labelNames: ['x'],
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const j = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'other', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addComment(i.key, { body: 'hi' }, { id: scaff.lead.id, role: 'LEAD' });
    await svc.linkIssues(
      { fromKey: i.key, toKey: j.key, type: 'BLOCKS' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.deleteIssue(i.key, { id: scaff.lead.id, role: 'LEAD' });
    expect(await prisma.comment.findMany({ where: { issueId: i.id } })).toHaveLength(0);
    expect(await prisma.issueLabel.findMany({ where: { issueId: i.id } })).toHaveLength(0);
    expect(await prisma.activityLogEntry.findMany({ where: { issueId: i.id } })).toHaveLength(0);
    expect(await prisma.issueLink.findMany({ where: { fromIssueId: i.id } })).toHaveLength(0);
  });
});
