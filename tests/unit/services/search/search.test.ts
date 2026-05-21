import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { createSearchService } from '@/server/services/search';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from '../issues/__support__/fakePrisma';

describe('search.searchIssues', () => {
  let prisma: FakePrisma;
  let issues: ReturnType<typeof createIssuesService>;
  let svc: ReturnType<typeof createSearchService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    issues = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
    svc = createSearchService({ prisma: prisma as never });
  });

  it('empty q falls back to listIssues', async () => {
    await issues.createIssue(
      { projectKey: 'ALPHA', title: 'login bug', type: 'BUG' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.searchIssues(
      { projectKey: 'ALPHA', q: '' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data).toHaveLength(1);
    expect(res.pageInfo.hasMore).toBe(false);
  });

  it('filter-only q behaves like listIssues with status filter', async () => {
    const a = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'BUG' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await issues.createIssue(
      { projectKey: 'ALPHA', title: 'b', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const res = await svc.searchIssues(
      { projectKey: 'ALPHA', q: '', filters: { type: ['BUG'] } },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(res.data.map((d) => d.id)).toEqual([a.id]);
  });

  it('with q, calls $queryRaw with websearch_to_tsquery and ranks results', async () => {
    // Seed three issues directly to control IDs
    const a = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'login bug', type: 'BUG' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const b = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'unrelated', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    void b;

    // Stub $queryRaw on the underlying fake prisma so we can assert query
    // shape + simulate ranking. The real Postgres exercise lives in the
    // integration tier.
    const queryRaw = vi.fn(async (..._args: unknown[]) => {
      // Pretend FTS returned only `a`, ranked.
      return [{ ...prismaIssueRow(a), rank: 0.8 }];
    });
    (prisma as unknown as { $queryRaw: typeof queryRaw }).$queryRaw = queryRaw;

    const res = await svc.searchIssues(
      { projectKey: 'ALPHA', q: 'login' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(queryRaw).toHaveBeenCalled();
    // Ensure the SQL template includes the rank ordering + tsquery construct
    const firstArg = queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    const sql = (firstArg?.strings ?? []).join(' ');
    expect(sql).toContain('websearch_to_tsquery');
    expect(sql).toContain('ts_rank');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.id).toBe(a.id);
  });
});

function prismaIssueRow(i: { id: string; key: string; title: string; status: string }) {
  return {
    id: i.id,
    key: i.key,
    title: i.title,
    status: i.status,
  };
}
