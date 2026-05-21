import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.linkIssues', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  async function pair() {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const b = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'b', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    return { a, b };
  }

  it('links two issues and emits issue.linked', async () => {
    const { a, b } = await pair();
    const handler = vi.fn();
    on(ISSUE_EVENTS.LINKED, handler);
    const link = await svc.linkIssues(
      { fromKey: a.key, toKey: b.key, type: 'BLOCKS' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(link.type).toBe('BLOCKS');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects self-link', async () => {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.linkIssues(
        { fromKey: a.key, toKey: a.key, type: 'RELATES_TO' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects duplicate (same triple)', async () => {
    const { a, b } = await pair();
    await svc.linkIssues(
      { fromKey: a.key, toKey: b.key, type: 'BLOCKS' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.linkIssues(
        { fromKey: a.key, toKey: b.key, type: 'BLOCKS' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('symmetric RELATES_TO dedup (b→a after a→b)', async () => {
    const { a, b } = await pair();
    await svc.linkIssues(
      { fromKey: a.key, toKey: b.key, type: 'RELATES_TO' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.linkIssues(
        { fromKey: b.key, toKey: a.key, type: 'RELATES_TO' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects cross-project links', async () => {
    // Create a second project
    const otherLead = await prisma.user.create({
      data: { email: 'other-lead@e.com', name: 'OL' },
    });
    await prisma.orgMembership.create({ data: { userId: otherLead.id, role: 'LEAD' } });
    const otherProject = await prisma.project.create({
      data: { key: 'BETA', name: 'Beta', leadId: otherLead.id },
    });
    await prisma.projectMember.create({
      data: { projectId: otherProject.id, userId: otherLead.id, role: 'LEAD' },
    });
    await prisma.issueCounter.create({ data: { projectId: otherProject.id, lastNumber: 0 } });
    const b = await svc.createIssue(
      { projectKey: 'BETA', title: 'b', type: 'TASK' },
      { id: otherLead.id, role: 'LEAD' },
    );
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.linkIssues(
        { fromKey: a.key, toKey: b.key, type: 'BLOCKS' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('unlinkIssues removes the row', async () => {
    const { a, b } = await pair();
    const link = await svc.linkIssues(
      { fromKey: a.key, toKey: b.key, type: 'BLOCKS' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.unlinkIssues(link.id, { id: scaff.lead.id, role: 'LEAD' });
    const after = await prisma.issueLink.findUnique({ where: { id: link.id } });
    expect(after).toBeNull();
  });
});
