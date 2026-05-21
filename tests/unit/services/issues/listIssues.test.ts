import { beforeEach, describe, expect, it } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.listIssues', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('filters by status', async () => {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const b = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'b', type: 'BUG' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.transitionIssue(a.key, 'IN_PROGRESS', { id: scaff.lead.id, role: 'LEAD' });
    const res = await svc.listIssues(
      { projectKey: 'ALPHA', status: ['IN_PROGRESS'] },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe(a.id);
    void b;
  });

  it("resolves 'me' assignee to actor", async () => {
    const mine = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'mine', type: 'TASK', assigneeId: scaff.member.id },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.createIssue(
      { projectKey: 'ALPHA', title: 'theirs', type: 'TASK', assigneeId: scaff.lead.id },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.listIssues(
      { projectKey: 'ALPHA', assigneeId: 'me' },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe(mine.id);
  });

  it("filters 'unassigned'", async () => {
    await svc.createIssue(
      { projectKey: 'ALPHA', title: 'na', type: 'TASK', assigneeId: scaff.lead.id },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const u = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'open', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.listIssues(
      { projectKey: 'ALPHA', assigneeId: 'unassigned' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe(u.id);
  });

  it('filters by labels', async () => {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'has-label', type: 'TASK', labelNames: ['frontend'] },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.createIssue(
      { projectKey: 'ALPHA', title: 'no-label', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.listIssues(
      { projectKey: 'ALPHA', labelNames: ['frontend'] },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data.map((d) => d.id)).toEqual([a.id]);
  });

  it('filters by priority and type', async () => {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'high', type: 'BUG', priority: 'HIGH' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.createIssue(
      { projectKey: 'ALPHA', title: 'low', type: 'TASK', priority: 'LOW' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const byPrio = await svc.listIssues(
      { projectKey: 'ALPHA', priority: ['HIGH'] },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(byPrio.data.map((d) => d.id)).toEqual([a.id]);
    const byType = await svc.listIssues(
      { projectKey: 'ALPHA', type: ['BUG'] },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(byType.data.map((d) => d.id)).toEqual([a.id]);
  });

  it('filters by title query (ILIKE)', async () => {
    const a = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'Hello world', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.createIssue(
      { projectKey: 'ALPHA', title: 'Goodbye', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.listIssues(
      { projectKey: 'ALPHA', query: 'hello' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data.map((d) => d.id)).toEqual([a.id]);
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await svc.createIssue(
        { projectKey: 'ALPHA', title: `i${i}`, type: 'TASK' },
        { id: scaff.lead.id, role: 'LEAD' },
      );
    }
    const page1 = await svc.listIssues(
      { projectKey: 'ALPHA', limit: 2 },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(page1.data).toHaveLength(2);
    expect(page1.pageInfo.hasMore).toBe(true);
    const page2 = await svc.listIssues(
      { projectKey: 'ALPHA', limit: 2, cursor: page1.pageInfo.nextCursor! },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(page2.data).toHaveLength(2);
    // No duplicates across pages
    const ids = new Set([...page1.data.map((d) => d.id), ...page2.data.map((d) => d.id)]);
    expect(ids.size).toBe(4);
  });
});
