// Search domain service.
//
// Postgres full-text search over the `Issue.search_tsv` column added in
// migration 20260521030000. The column is GENERATED ALWAYS, so we never
// write to it — we just query it. Ranking is `ts_rank(search_tsv,
// websearch_to_tsquery(...))` descending, with `(createdAt, id)` as the
// stable tiebreaker for cursor pagination.
//
// When `q` is empty we delegate to `listIssues` so the search page can be
// driven solely by filter chips (the "open search" affordance).

import { z } from 'zod';
import type { Issue, IssueStatus, PrismaClient, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { ROLE_RANK, hasRoleAtLeast } from '@/server/auth/roles';
import {
  createIssuesService,
  issuePrioritySchema,
  issueStatusSchema,
  issueTypeSchema,
  type ListIssuesInput,
} from '@/server/services/issues';

export { AuthError } from '@/lib/errors';

export type Actor = { id: string; role: Role };

export type SearchServiceDeps = {
  prisma: PrismaClient;
};

export const searchFiltersSchema = z
  .object({
    status: z.array(issueStatusSchema).optional(),
    priority: z.array(issuePrioritySchema).optional(),
    type: z.array(issueTypeSchema).optional(),
    assigneeId: z.string().optional(),
    labelNames: z.array(z.string()).optional(),
  })
  .partial()
  .optional();
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const searchInputSchema = z.object({
  projectKey: z.string().min(1),
  q: z.string().optional().default(''),
  filters: searchFiltersSchema,
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AuthError('invalid_input', result.error.issues[0]?.message, result.error.flatten());
  }
  return result.data;
}

function maxRole(a: Role, b: Role): Role {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

type RankedRow = Issue & { rank: number };

export function createSearchService(deps: SearchServiceDeps) {
  const { prisma } = deps;
  const issues = createIssuesService({ prisma });

  async function resolveProject(
    projectKey: string,
    actor: Actor,
  ): Promise<{ id: string; key: string }> {
    const project = await prisma.project.findUnique({ where: { key: projectKey } });
    if (!project) throw new AuthError('not_found', `Project "${projectKey}" not found`);
    if (actor.role === 'ADMIN') return project;
    const member = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: actor.id },
    });
    if (!member) throw new AuthError('forbidden', `Not a member of project ${projectKey}`);
    const viewerRole = maxRole(actor.role, member.role);
    if (!hasRoleAtLeast(viewerRole, 'VIEWER')) {
      throw new AuthError('forbidden', `Requires VIEWER on project ${projectKey}`);
    }
    return project;
  }

  async function searchIssues(
    input: SearchInput,
    actor: Actor,
  ): Promise<{ data: Issue[]; pageInfo: { nextCursor: string | null; hasMore: boolean } }> {
    const data = parseOrThrow(searchInputSchema, input);
    const trimmed = (data.q ?? '').trim();

    // No query? Reuse listIssues — its filter shape is a superset of ours.
    if (trimmed === '') {
      const listInput: ListIssuesInput = {
        projectKey: data.projectKey,
        status: data.filters?.status,
        priority: data.filters?.priority,
        type: data.filters?.type,
        assigneeId: data.filters?.assigneeId,
        labelNames: data.filters?.labelNames,
        cursor: data.cursor,
        limit: data.limit,
      };
      return issues.listIssues(listInput, actor);
    }

    // FTS path. Authorize before running raw SQL.
    const project = await resolveProject(data.projectKey, actor);
    const limit = data.limit ?? 25;

    // Build filter fragments. Using Prisma.sql + Prisma.join keeps user input
    // parameterized; tsquery itself is constructed by Postgres via
    // websearch_to_tsquery so no string concat into the FTS expression.
    const filters: Prisma.Sql[] = [Prisma.sql`"projectId" = ${project.id}`];
    if (data.filters?.status?.length) {
      filters.push(
        Prisma.sql`"status"::text IN (${Prisma.join(data.filters.status as IssueStatus[])})`,
      );
    }
    if (data.filters?.priority?.length) {
      filters.push(Prisma.sql`"priority"::text IN (${Prisma.join(data.filters.priority)})`);
    }
    if (data.filters?.type?.length) {
      filters.push(Prisma.sql`"type"::text IN (${Prisma.join(data.filters.type)})`);
    }
    if (data.filters?.assigneeId) {
      const aid = data.filters.assigneeId;
      if (aid === 'me') {
        filters.push(Prisma.sql`"assigneeId" = ${actor.id}`);
      } else if (aid === 'unassigned') {
        filters.push(Prisma.sql`"assigneeId" IS NULL`);
      } else {
        filters.push(Prisma.sql`"assigneeId" = ${aid}`);
      }
    }
    filters.push(Prisma.sql`"search_tsv" @@ websearch_to_tsquery('english', ${trimmed})`);

    // Cursor-based keyset pagination on (createdAt DESC, id DESC).
    // When a cursor (issue id from the previous page) is supplied, look up that
    // row so we can anchor the WHERE clause on its stable (createdAt, id) pair.
    if (data.cursor) {
      const anchor = await prisma.issue.findUnique({
        where: { id: data.cursor },
        select: { createdAt: true, id: true },
      });
      if (anchor) {
        filters.push(
          Prisma.sql`("createdAt" < ${anchor.createdAt} OR ("createdAt" = ${anchor.createdAt} AND "id" < ${anchor.id}))`,
        );
      }
    }

    const whereSql = Prisma.join(filters, ' AND ');

    // Over-fetch by 1 to compute `hasMore`.
    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT "Issue".*,
             ts_rank("search_tsv", websearch_to_tsquery('english', ${trimmed})) AS rank
        FROM "Issue"
       WHERE ${whereSql}
       ORDER BY rank DESC, "createdAt" DESC, "id" DESC
       LIMIT ${limit + 1}
    `)) as RankedRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    // Strip the synthetic `rank` field before returning so callers see the
    // public Issue shape.
    const data2: Issue[] = page.map((r) => {
      const { rank: _rank, ...rest } = r;
      void _rank;
      return rest as Issue;
    });
    return { data: data2, pageInfo: { nextCursor, hasMore } };
  }

  return { searchIssues };
}

export type SearchService = ReturnType<typeof createSearchService>;
