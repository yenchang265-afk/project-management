import { beforeEach, describe, expect, it } from 'vitest';

import { createBoardsService } from '@/server/services/boards';
import { createIssuesService } from '@/server/services/issues';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from '../issues/__support__/fakePrisma';

describe('boards.getBacklog', () => {
  let prisma: FakePrisma;
  let issues: ReturnType<typeof createIssuesService>;
  let svc: ReturnType<typeof createBoardsService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    issues = createIssuesService({ prisma: prisma as never });
    svc = createBoardsService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('returns only TODO issues by default', async () => {
    const t = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'todo', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const w = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'wip', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await issues.transitionIssue(w.key, 'IN_PROGRESS', { id: scaff.lead.id, role: 'LEAD' });

    const res = await svc.getBacklog({ projectKey: 'ALPHA' }, { id: scaff.lead.id, role: 'LEAD' });
    expect(res.data.map((i) => i.id)).toEqual([t.id]);
  });

  it('honors filters such as priority', async () => {
    const high = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'high', type: 'TASK', priority: 'HIGH' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await issues.createIssue(
      { projectKey: 'ALPHA', title: 'low', type: 'TASK', priority: 'LOW' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.getBacklog(
      { projectKey: 'ALPHA', filters: { priority: ['HIGH'] } },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data.map((i) => i.id)).toEqual([high.id]);
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 4; i++) {
      await issues.createIssue(
        { projectKey: 'ALPHA', title: `t${i}`, type: 'TASK' },
        { id: scaff.lead.id, role: 'LEAD' },
      );
    }
    const page1 = await svc.getBacklog(
      { projectKey: 'ALPHA', limit: 2 },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(page1.data).toHaveLength(2);
    expect(page1.pageInfo.hasMore).toBe(true);
  });
});
