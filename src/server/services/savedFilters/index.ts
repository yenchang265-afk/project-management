// Saved filters domain service.
//
// A saved filter persists a `listIssues`-shaped query spec under a name so
// the Boards / Backlog / Search UIs can recall it. Filters are user-owned.
// Optional `projectId` scopes a filter to a project — listing scoped filters
// requires project membership (the same VIEWER gate as other project reads).

import { z } from 'zod';
import type { PrismaClient, Role, SavedFilter } from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { ROLE_RANK, hasRoleAtLeast } from '@/server/auth/roles';
import { issuePrioritySchema, issueStatusSchema, issueTypeSchema } from '@/server/services/issues';

export { AuthError } from '@/lib/errors';

export type Actor = { id: string; role: Role };

export type SavedFiltersServiceDeps = {
  prisma: PrismaClient;
};

// The same shape `listIssues` accepts (minus projectKey + cursor — those are
// supplied at apply-time, not save-time). Kept tolerant of additional keys so
// future filter dimensions (sprint, label combinations) don't require a
// schema migration.
export const savedFilterQuerySchema = z
  .object({
    status: z.array(issueStatusSchema).optional(),
    priority: z.array(issuePrioritySchema).optional(),
    type: z.array(issueTypeSchema).optional(),
    assigneeId: z.string().optional(),
    labelNames: z.array(z.string()).optional(),
    query: z.string().optional(),
    q: z.string().optional(),
  })
  .strict();
export type SavedFilterQuery = z.infer<typeof savedFilterQuerySchema>;

export const createFilterInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  projectId: z.string().min(1).optional(),
  query: savedFilterQuerySchema,
});
export type CreateFilterInput = z.infer<typeof createFilterInputSchema>;

export const updateFilterInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    query: savedFilterQuerySchema.optional(),
  })
  .strict();
export type UpdateFilterInput = z.infer<typeof updateFilterInputSchema>;

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

export function createSavedFiltersService(deps: SavedFiltersServiceDeps) {
  const { prisma } = deps;

  async function assertProjectAccess(projectId: string, actor: Actor): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new AuthError('not_found', 'Project not found');
    }
    const member = await prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
    });
    if (!member) {
      throw new AuthError('forbidden', 'Not a member of this project');
    }
    const effective = maxRole(actor.role, member.role);
    if (!hasRoleAtLeast(effective, 'VIEWER')) {
      throw new AuthError('forbidden', 'Insufficient role on project');
    }
  }

  async function createFilter(input: CreateFilterInput, actor: Actor): Promise<SavedFilter> {
    const data = parseOrThrow(createFilterInputSchema, input);
    if (data.projectId) {
      await assertProjectAccess(data.projectId, actor);
    }
    return prisma.savedFilter.create({
      data: {
        userId: actor.id,
        projectId: data.projectId ?? null,
        name: data.name,
        // `query` is typed `Json` in Prisma — cast through `as never` so the
        // generated client accepts our already-validated payload without
        // ceremony.
        query: data.query as never,
      },
    });
  }

  async function listFilters(
    actor: Actor,
    opts: { projectId?: string } = {},
  ): Promise<SavedFilter[]> {
    if (opts.projectId) {
      await assertProjectAccess(opts.projectId, actor);
      return prisma.savedFilter.findMany({
        where: { userId: actor.id, projectId: opts.projectId },
        orderBy: { createdAt: 'desc' },
      });
    }
    return prisma.savedFilter.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function getFilter(id: string, actor: Actor): Promise<SavedFilter> {
    const row = await prisma.savedFilter.findUnique({ where: { id } });
    if (!row) throw new AuthError('not_found', 'Filter not found');
    if (row.userId !== actor.id && actor.role !== 'ADMIN') {
      throw new AuthError('forbidden', 'Not your filter');
    }
    return row;
  }

  async function updateFilter(
    id: string,
    patch: UpdateFilterInput,
    actor: Actor,
  ): Promise<SavedFilter> {
    const data = parseOrThrow(updateFilterInputSchema, patch);
    const existing = await prisma.savedFilter.findUnique({ where: { id } });
    if (!existing) throw new AuthError('not_found', 'Filter not found');
    if (existing.userId !== actor.id) {
      throw new AuthError('forbidden', 'Only the owner can update this filter');
    }
    const updateData: { name?: string; query?: unknown } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.query !== undefined) updateData.query = data.query;
    return prisma.savedFilter.update({
      where: { id },
      data: updateData as never,
    });
  }

  async function deleteFilter(id: string, actor: Actor): Promise<void> {
    const existing = await prisma.savedFilter.findUnique({ where: { id } });
    if (!existing) throw new AuthError('not_found', 'Filter not found');
    if (existing.userId !== actor.id) {
      throw new AuthError('forbidden', 'Only the owner can delete this filter');
    }
    await prisma.savedFilter.delete({ where: { id } });
  }

  return { createFilter, listFilters, getFilter, updateFilter, deleteFilter };
}

export type SavedFiltersService = ReturnType<typeof createSavedFiltersService>;
