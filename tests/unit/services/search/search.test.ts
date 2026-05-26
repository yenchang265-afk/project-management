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

  it('with q, applies status / priority / type / assignee filters into the raw SQL', async () => {
    const issue = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'login bug', type: 'BUG', priority: 'HIGH' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const queryRaw = vi.fn(async (..._args: unknown[]) => [
      { ...prismaIssueRow(issue), rank: 0.5 },
    ]);
    (prisma as unknown as { $queryRaw: typeof queryRaw }).$queryRaw = queryRaw;

    await svc.searchIssues(
      {
        projectKey: 'ALPHA',
        q: 'login',
        filters: {
          status: ['TODO'],
          priority: ['HIGH'],
          type: ['BUG'],
          assigneeId: scaff.lead.id,
        },
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const sql = ((queryRaw.mock.calls[0]?.[0] as { strings?: string[] })?.strings ?? []).join(' ');
    expect(sql).toContain('"status"::text IN');
    expect(sql).toContain('"priority"::text IN');
    expect(sql).toContain('"type"::text IN');
    expect(sql).toContain('"assigneeId" =');
  });

  it('with q, resolves assigneeId="me" and "unassigned"', async () => {
    const issue = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'login bug', type: 'BUG' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const queryRaw = vi.fn(async () => [{ ...prismaIssueRow(issue), rank: 0.5 }]);
    (prisma as unknown as { $queryRaw: typeof queryRaw }).$queryRaw = queryRaw;

    await svc.searchIssues(
      { projectKey: 'ALPHA', q: 'login', filters: { assigneeId: 'me' } },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(sqlOf(queryRaw)).toContain('"assigneeId" =');

    queryRaw.mockClear();
    await svc.searchIssues(
      { projectKey: 'ALPHA', q: 'login', filters: { assigneeId: 'unassigned' } },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(sqlOf(queryRaw)).toContain('"assigneeId" IS NULL');
  });
});

function sqlOf(mock: { mock: { calls: unknown[][] } }): string {
  const first = (mock.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>)[0];
  const firstArg = first ? first[0] : undefined;
  const strings = (firstArg as { strings?: string[] } | undefined)?.strings ?? [];
  return strings.join(' ');
}

function prismaIssueRow(i: { id: string; key: string; title: string; status: string }) {
  return {
    id: i.id,
    key: i.key,
    title: i.title,
    status: i.status,
  };
}
