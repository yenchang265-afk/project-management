// Projects domain service. All RBAC + project CRUD invariants live here so
// route handlers / RSC pages stay thin and Phase 3 (Issues) can consume the
// public contract (`getProjectByKey`, `nextIssueNumber`) without coupling to
// Prisma directly.

import { z } from 'zod';
import type { PrismaClient, Project, ProjectMember, Role } from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { ROLE_RANK, hasRoleAtLeast } from '@/server/auth/roles';

export { AuthError } from '@/lib/errors';

export const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;

export const projectKeySchema = z
  .string()
  .regex(PROJECT_KEY_REGEX, 'Key must be 2–10 chars, start with a letter, A–Z/0–9 only');

export const createProjectInputSchema = z.object({
  key: projectKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  leadId: z.string().min(1),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const renameProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type RenameProjectInput = z.infer<typeof renameProjectInputSchema>;

export type Actor = { id: string; role: Role };

export type ListOptions = { includeArchived?: boolean };

export type GetProjectByKeyResult = {
  project: Project;
  viewerRole: Role;
};

export type ProjectsServiceDeps = {
  prisma: PrismaClient;
};

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

export function createProjectsService(deps: ProjectsServiceDeps) {
  const { prisma } = deps;

  async function getEffectiveRole(projectId: string, actor: Actor): Promise<Role | null> {
    if (actor.role === 'ADMIN') return 'ADMIN';
    const member = await prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
    });
    if (!member) return null;
    return maxRole(actor.role, member.role);
  }

  async function createProject(input: CreateProjectInput, actor: Actor): Promise<Project> {
    if (!hasRoleAtLeast(actor.role, 'LEAD')) {
      throw new AuthError('forbidden', 'Requires LEAD or higher to create projects');
    }
    const data = parseOrThrow(createProjectInputSchema, input);
    try {
      const project = await prisma.project.create({
        data: {
          key: data.key,
          name: data.name,
          description: data.description ?? null,
          leadId: data.leadId,
        },
      });
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: data.leadId, role: 'LEAD' },
      });
      await prisma.issueCounter.create({
        data: { projectId: project.id, lastNumber: 0 },
      });
      return project;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new AuthError('duplicate_key', `Project key "${data.key}" is already taken`);
      }
      throw err;
    }
  }

  async function renameProject(
    projectId: string,
    input: RenameProjectInput,
    actor: Actor,
  ): Promise<Project> {
    const data = parseOrThrow(renameProjectInputSchema, input);
    const effective = await getEffectiveRole(projectId, actor);
    if (!effective || !hasRoleAtLeast(effective, 'LEAD')) {
      throw new AuthError('forbidden', 'Requires LEAD on the project');
    }
    const patch: Partial<Pick<Project, 'name' | 'description'>> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    return prisma.project.update({ where: { id: projectId }, data: patch });
  }

  async function archiveProject(projectId: string, actor: Actor): Promise<Project> {
    const effective = await getEffectiveRole(projectId, actor);
    if (!effective || !hasRoleAtLeast(effective, 'LEAD')) {
      throw new AuthError('forbidden', 'Requires LEAD on the project');
    }
    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) throw new AuthError('not_found', 'Project not found');
    if (existing.archivedAt) return existing; // idempotent
    return prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date() },
    });
  }

  async function listProjects(actor: Actor, opts: ListOptions = {}): Promise<Project[]> {
    const where: Parameters<typeof prisma.project.findMany>[0] extends infer P
      ? P extends { where?: infer W }
        ? W
        : never
      : never = {};
    if (!opts.includeArchived) {
      (where as { archivedAt?: null }).archivedAt = null;
    }
    if (actor.role !== 'ADMIN') {
      (where as { members?: { some: { userId: string } } }).members = {
        some: { userId: actor.id },
      };
    }
    return prisma.project.findMany({ where, orderBy: { key: 'asc' } });
  }

  async function getProjectByKey(key: string, actor: Actor): Promise<GetProjectByKeyResult> {
    const project = await prisma.project.findUnique({ where: { key } });
    if (!project) {
      throw new AuthError('not_found', `Project "${key}" not found`);
    }
    if (actor.role === 'ADMIN') {
      return { project, viewerRole: 'ADMIN' };
    }
    const member = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: actor.id },
    });
    if (!member) {
      throw new AuthError('forbidden', 'Not a member of this project');
    }
    return { project, viewerRole: maxRole(actor.role, member.role) };
  }

  async function listMembers(projectId: string): Promise<ProjectMember[]> {
    return prisma.projectMember.findMany({ where: { projectId } });
  }

  // Atomic increment. Caller MUST pass a transaction client (`tx`) — calling
  // outside a transaction risks lost updates under concurrency. Phase 3 will
  // wrap this in its issue-creation transaction.
  type TxLike = Pick<PrismaClient, 'issueCounter'>;
  async function nextIssueNumber(projectId: string, tx: TxLike): Promise<number> {
    const result = await tx.issueCounter.update({
      where: { projectId },
      data: { lastNumber: { increment: 1 } },
    });
    return result.lastNumber;
  }

  return {
    createProject,
    renameProject,
    archiveProject,
    listProjects,
    getProjectByKey,
    listMembers,
    nextIssueNumber,
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;
