// Boards domain service.
//
// Phase 4a thin wrapper over the Issues service. The board is a
// status-bucketed view of `listIssues`, and `moveIssueOnBoard` defers to
// `transitionIssue` so the same transition rules apply.  We don't duplicate
// transition state machines here — the board is a UI shape, not a new
// authority on what statuses exist.
//
// TODO (Phase 4b): the backlog should exclude issues that are members of
// the active sprint once the Sprint model lands. For now it's all TODO.

import { z } from 'zod';
import type { Issue, IssueStatus, PrismaClient, Project, Role } from '@prisma/client';

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

export const BOARD_COLUMNS: IssueStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

export type Actor = { id: string; role: Role };

export type BoardsServiceDeps = {
  prisma: PrismaClient;
};

export type BoardColumn = {
  status: IssueStatus;
  issues: Issue[];
};

export type Board = {
  project: Project;
  columns: BoardColumn[];
};

export const moveIssueInputSchema = z.object({
  issueKey: z.string().min(1),
  toStatus: issueStatusSchema,
});
export type MoveIssueInput = z.infer<typeof moveIssueInputSchema>;

// Mirror the subset of listIssues filters we accept on backlog/board.
export const boardFiltersSchema = z
  .object({
    priority: z.array(issuePrioritySchema).optional(),
    type: z.array(issueTypeSchema).optional(),
    assigneeId: z.string().optional(),
    labelNames: z.array(z.string()).optional(),
    query: z.string().optional(),
  })
  .partial()
  .optional();
export type BoardFilters = z.infer<typeof boardFiltersSchema>;

export const backlogInputSchema = z.object({
  projectKey: z.string().min(1),
  filters: boardFiltersSchema,
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});
export type BacklogInput = z.infer<typeof backlogInputSchema>;

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

export function createBoardsService(deps: BoardsServiceDeps) {
  const { prisma } = deps;
  const issues = createIssuesService({ prisma });

  async function resolveProject(
    projectKey: string,
    min: Role,
    actor: Actor,
  ): Promise<{ project: Project; viewerRole: Role }> {
    const project = await prisma.project.findUnique({ where: { key: projectKey } });
    if (!project) throw new AuthError('not_found', `Project "${projectKey}" not found`);
    let viewerRole: Role;
    if (actor.role === 'ADMIN') {
      viewerRole = 'ADMIN';
    } else {
      const member = await prisma.projectMember.findFirst({
        where: { projectId: project.id, userId: actor.id },
      });
      if (!member) {
        throw new AuthError('forbidden', `Not a member of project ${projectKey}`);
      }
      viewerRole = maxRole(actor.role, member.role);
    }
    if (!hasRoleAtLeast(viewerRole, min)) {
      throw new AuthError('forbidden', `Requires role ${min} or higher on project ${projectKey}`);
    }
    return { project, viewerRole };
  }

  async function getBoard(projectKey: string, actor: Actor): Promise<Board> {
    const { project } = await resolveProject(projectKey, 'VIEWER', actor);

    // Pull each column's issues independently. Using listIssues keeps RBAC
    // and filter semantics consistent with backlog/search. Page size kept
    // generous so columns aren't truncated under typical usage.
    const columns: BoardColumn[] = [];
    for (const status of BOARD_COLUMNS) {
      const res = await issues.listIssues({ projectKey, status: [status], limit: 100 }, actor);
      columns.push({ status, issues: res.data });
    }
    return { project, columns };
  }

  async function moveIssueOnBoard(input: MoveIssueInput, actor: Actor): Promise<Issue> {
    const data = parseOrThrow(moveIssueInputSchema, input);
    return issues.transitionIssue(data.issueKey, data.toStatus, actor);
  }

  async function getBacklog(
    input: BacklogInput,
    actor: Actor,
  ): Promise<{ data: Issue[]; pageInfo: { nextCursor: string | null; hasMore: boolean } }> {
    const data = parseOrThrow(backlogInputSchema, input);
    // Defer authorization and filtering to listIssues; force status TODO.
    const listInput: ListIssuesInput = {
      projectKey: data.projectKey,
      status: ['TODO'],
      priority: data.filters?.priority,
      type: data.filters?.type,
      assigneeId: data.filters?.assigneeId,
      labelNames: data.filters?.labelNames,
      query: data.filters?.query,
      cursor: data.cursor,
      limit: data.limit,
    };
    return issues.listIssues(listInput, actor);
  }

  return { getBoard, moveIssueOnBoard, getBacklog, BOARD_COLUMNS };
}

export type BoardsService = ReturnType<typeof createBoardsService>;
