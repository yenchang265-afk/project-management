// Sprints domain service (Phase 4b).
//
// Responsibilities:
//   - Sprint CRUD: create/start/complete and sprint listing.
//   - Sprint membership: add/remove/reorder issues on a sprint.
//   - Burndown read-model from ActivityLogEntry rows.
//   - Domain events on the in-process bus (see src/server/events/sprintTypes.ts).
//
// Authorization helpers are inlined here (same shape as the Issues service)
// so unit tests can drive everything through the in-memory fake Prisma.
// We intentionally do NOT modify the Issue/Project/Comment models — Sprint
// state lives in its own tables.

import { z } from 'zod';
import type {
  IssueStatus,
  PrismaClient,
  Role,
  Sprint,
  SprintIssue,
  SprintState,
} from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { ROLE_RANK, hasRoleAtLeast } from '@/server/auth/roles';
import { emit } from '@/server/events/bus';
import { SPRINT_EVENTS } from '@/server/events/sprintTypes';

export { AuthError } from '@/lib/errors';

// ----- types -----

export type Actor = { id: string; role: Role };
export type SprintsServiceDeps = { prisma: PrismaClient };

// ----- rank constants -----

/** Initial spacing between consecutive sprint-issue ranks. */
export const RANK_STEP = 1024;
/** Minimum spacing tolerated between neighboring ranks before we rebalance. */
export const RANK_MIN_GAP = 2;
/** Spacing applied during a rebalance (also used as the new uniform step). */
export const REBALANCE_GAP = 1024;

// ----- input schemas -----

export const createSprintInputSchema = z.object({
  projectKey: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  goal: z.string().trim().max(2_000).optional(),
});
export type CreateSprintInput = z.infer<typeof createSprintInputSchema>;

export const addIssueInputSchema = z.object({
  sprintId: z.string().min(1),
  issueKey: z.string().min(1),
});
export type AddIssueInput = z.infer<typeof addIssueInputSchema>;

export const reorderInputSchema = z.object({
  sprintId: z.string().min(1),
  issueKey: z.string().min(1),
  beforeIssueKey: z.string().min(1).optional(),
});
export type ReorderInput = z.infer<typeof reorderInputSchema>;

export const startSprintOptionsSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type StartSprintOptions = z.infer<typeof startSprintOptionsSchema>;

// ----- helpers -----

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

function projectKeyFromIssueKey(issueKey: string): string {
  const idx = issueKey.lastIndexOf('-');
  if (idx < 0) throw new AuthError('invalid_input', `Malformed issue key: "${issueKey}"`);
  return issueKey.slice(0, idx);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function endOfDay(dateStr: string): Date {
  // 23:59:59.999 UTC of the given YYYY-MM-DD
  return new Date(`${dateStr}T23:59:59.999Z`);
}

// ----- factory -----

export function createSprintsService(deps: SprintsServiceDeps) {
  const { prisma } = deps;

  async function resolveProjectAccess(
    projectKey: string,
    min: Role,
    actor: Actor,
  ): Promise<{ project: { id: string; key: string }; viewerRole: Role }> {
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
    return { project: { id: project.id, key: project.key }, viewerRole };
  }

  async function loadSprintOrThrow(sprintId: string): Promise<Sprint> {
    const sprint = (await prisma.sprint.findUnique({ where: { id: sprintId } })) as Sprint | null;
    if (!sprint) throw new AuthError('not_found', `Sprint ${sprintId} not found`);
    return sprint;
  }

  async function projectKeyForSprint(sprint: Sprint): Promise<string> {
    const proj = await prisma.project.findUnique({ where: { id: sprint.projectId } });
    if (!proj) throw new AuthError('not_found', 'Project for sprint not found');
    return proj.key;
  }

  // ------------------------------ createSprint -----------------------------

  async function createSprint(input: CreateSprintInput, actor: Actor): Promise<Sprint> {
    const data = parseOrThrow(createSprintInputSchema, input);
    const { project } = await resolveProjectAccess(data.projectKey, 'LEAD', actor);
    const sprint = (await prisma.sprint.create({
      data: {
        projectId: project.id,
        name: data.name,
        goal: data.goal ?? null,
        state: 'PLANNED',
      },
    })) as Sprint;
    emit(SPRINT_EVENTS.CREATED, {
      sprintId: sprint.id,
      projectId: project.id,
      actorId: actor.id,
      name: sprint.name,
      state: sprint.state,
    });
    return sprint;
  }

  // --------------------------- addIssueToSprint ----------------------------

  async function addIssueToSprint(input: AddIssueInput, actor: Actor): Promise<SprintIssue> {
    const data = parseOrThrow(addIssueInputSchema, input);
    const sprint = await loadSprintOrThrow(data.sprintId);
    const projectKey = await projectKeyForSprint(sprint);
    await resolveProjectAccess(projectKey, 'MEMBER', actor);

    if (sprint.state === 'COMPLETED') {
      throw new AuthError('invalid_transition', 'Cannot add issues to a completed sprint');
    }

    const issue = await prisma.issue.findUnique({ where: { key: data.issueKey } });
    if (!issue) throw new AuthError('not_found', `Issue ${data.issueKey} not found`);
    if (issue.projectId !== sprint.projectId) {
      throw new AuthError('invalid_input', 'Issue belongs to a different project');
    }

    // Reject if already in another sprint of the same project.
    const existingMembership = await prisma.sprintIssue.findFirst({
      where: { issueId: issue.id, sprint: { projectId: sprint.projectId } },
    });
    if (existingMembership) {
      throw new AuthError('conflict', 'Issue is already in a sprint in this project');
    }

    // Assign rank = current max + RANK_STEP (start at RANK_STEP for empty).
    const existing = await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'desc' },
    });
    const nextRank = (existing[0]?.rank ?? 0) + RANK_STEP;

    const row = (await prisma.sprintIssue.create({
      data: { sprintId: sprint.id, issueId: issue.id, rank: nextRank },
    })) as SprintIssue;

    emit(SPRINT_EVENTS.ISSUE_ADDED, {
      sprintId: sprint.id,
      projectId: sprint.projectId,
      actorId: actor.id,
      issueId: issue.id,
      issueKey: issue.key,
      rank: row.rank,
    });

    return row;
  }

  // -------------------------- removeIssueFromSprint ------------------------

  async function removeIssueFromSprint(input: AddIssueInput, actor: Actor): Promise<void> {
    const data = parseOrThrow(addIssueInputSchema, input);
    const sprint = await loadSprintOrThrow(data.sprintId);
    const projectKey = await projectKeyForSprint(sprint);
    await resolveProjectAccess(projectKey, 'MEMBER', actor);

    if (sprint.state === 'COMPLETED') {
      throw new AuthError('invalid_transition', 'Cannot remove issues from a completed sprint');
    }

    const issue = await prisma.issue.findUnique({ where: { key: data.issueKey } });
    if (!issue) throw new AuthError('not_found', `Issue ${data.issueKey} not found`);
    const row = await prisma.sprintIssue.findUnique({
      where: { sprintId_issueId: { sprintId: sprint.id, issueId: issue.id } },
    });
    if (!row) throw new AuthError('not_found', 'Issue is not in this sprint');

    await prisma.sprintIssue.delete({
      where: { sprintId_issueId: { sprintId: sprint.id, issueId: issue.id } },
    });

    emit(SPRINT_EVENTS.ISSUE_REMOVED, {
      sprintId: sprint.id,
      projectId: sprint.projectId,
      actorId: actor.id,
      issueId: issue.id,
      issueKey: issue.key,
    });
  }

  // ---------------------------- reorderSprintIssue -------------------------

  async function rebalance(sprintId: string): Promise<void> {
    const rows = await prisma.sprintIssue.findMany({
      where: { sprintId },
      orderBy: { rank: 'asc' },
    });
    // Two-phase to avoid (sprintId, rank) collisions: push everything to negative
    // space first, then back to the target ranks. Both phases run inside a single
    // transaction so concurrent writers never observe partial ranks.
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        await tx.sprintIssue.update({
          where: { sprintId_issueId: { sprintId: r.sprintId, issueId: r.issueId } },
          data: { rank: -REBALANCE_GAP * (rows.length - i) },
        });
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        await tx.sprintIssue.update({
          where: { sprintId_issueId: { sprintId: r.sprintId, issueId: r.issueId } },
          data: { rank: REBALANCE_GAP * (i + 1) },
        });
      }
    });
  }

  async function reorderSprintIssue(input: ReorderInput, actor: Actor): Promise<SprintIssue> {
    const data = parseOrThrow(reorderInputSchema, input);
    const sprint = await loadSprintOrThrow(data.sprintId);
    const projectKey = await projectKeyForSprint(sprint);
    await resolveProjectAccess(projectKey, 'MEMBER', actor);

    const issue = await prisma.issue.findUnique({ where: { key: data.issueKey } });
    if (!issue) throw new AuthError('not_found', `Issue ${data.issueKey} not found`);

    const me = await prisma.sprintIssue.findUnique({
      where: { sprintId_issueId: { sprintId: sprint.id, issueId: issue.id } },
    });
    if (!me) throw new AuthError('not_found', 'Issue is not in this sprint');

    // Determine target rank.
    const rowsAsc = (await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    })) as SprintIssue[];

    let beforeRow: SprintIssue | null = null;
    if (data.beforeIssueKey) {
      const beforeIssue = await prisma.issue.findUnique({ where: { key: data.beforeIssueKey } });
      if (!beforeIssue) throw new AuthError('not_found', 'before issue not found');
      beforeRow =
        rowsAsc.find((r) => r.issueId === beforeIssue.id && r.issueId !== issue.id) ?? null;
      if (!beforeRow) {
        throw new AuthError('invalid_input', 'before issue is not in this sprint');
      }
    }

    // The "neighbors" are computed against the list excluding the moving row,
    // since we will re-anchor it.
    const others = rowsAsc.filter((r) => r.issueId !== issue.id);
    let target: number;
    if (!beforeRow) {
      // Move to bottom.
      const lastRank = others.length > 0 ? others[others.length - 1]!.rank : 0;
      target = lastRank + RANK_STEP;
    } else {
      const beforeIdx = others.findIndex((r) => r.issueId === beforeRow!.issueId);
      const prev = beforeIdx > 0 ? others[beforeIdx - 1] : null;
      if (!prev) {
        // Insert at the very top.
        target = beforeRow.rank - RANK_STEP;
        if (target <= 0) {
          await rebalance(sprint.id);
          // After rebalance the first row has rank REBALANCE_GAP; place before it
          // at half that spacing. Using REBALANCE_GAP/2 (> 0) avoids re-entering
          // the rebalance path, which would otherwise loop forever since the first
          // row's rank stays at REBALANCE_GAP after every rebalance.
          target = Math.floor(REBALANCE_GAP / 2);
        }
      } else {
        target = Math.floor((prev.rank + beforeRow.rank) / 2);
        if (beforeRow.rank - prev.rank < RANK_MIN_GAP) {
          // Tight collision — rebalance first, then recompute against the
          // freshly-spaced rows.
          await rebalance(sprint.id);
          return reorderSprintIssue(input, actor);
        }
      }
    }

    const updated = (await prisma.sprintIssue.update({
      where: { sprintId_issueId: { sprintId: sprint.id, issueId: issue.id } },
      data: { rank: target },
    })) as SprintIssue;

    return updated;
  }

  // ------------------------------- startSprint -----------------------------

  async function startSprint(
    sprintId: string,
    opts: StartSprintOptions,
    actor: Actor,
  ): Promise<Sprint> {
    const parsed = parseOrThrow(startSprintOptionsSchema, opts);
    const sprint = await loadSprintOrThrow(sprintId);
    const projectKey = await projectKeyForSprint(sprint);
    await resolveProjectAccess(projectKey, 'LEAD', actor);

    if (sprint.state !== 'PLANNED') {
      throw new AuthError('invalid_transition', `Cannot start sprint in state ${sprint.state}`);
    }
    // Service-level guard so we can return a clean conflict before the DB
    // partial-unique-index raises P2002.
    const conflicting = await prisma.sprint.findFirst({
      where: { projectId: sprint.projectId, state: 'ACTIVE' },
    });
    if (conflicting) {
      throw new AuthError('conflict', 'Another sprint is already active in this project');
    }

    const startDate = parsed.startDate ?? new Date();
    let updated: Sprint;
    try {
      updated = (await prisma.sprint.update({
        where: { id: sprint.id },
        data: {
          state: 'ACTIVE',
          startDate,
          endDate: parsed.endDate ?? sprint.endDate,
        },
      })) as Sprint;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        throw new AuthError('conflict', 'Another sprint is already active in this project');
      }
      throw err;
    }

    emit(SPRINT_EVENTS.STARTED, {
      sprintId: updated.id,
      projectId: updated.projectId,
      actorId: actor.id,
      startDate: updated.startDate!,
      endDate: updated.endDate,
    });

    return updated;
  }

  // ----------------------------- completeSprint ----------------------------

  async function completeSprint(sprintId: string, actor: Actor): Promise<Sprint> {
    const sprint = await loadSprintOrThrow(sprintId);
    const projectKey = await projectKeyForSprint(sprint);
    await resolveProjectAccess(projectKey, 'LEAD', actor);

    if (sprint.state !== 'ACTIVE') {
      throw new AuthError('invalid_transition', `Cannot complete sprint in state ${sprint.state}`);
    }

    // Move incomplete issues back to backlog: delete their SprintIssue rows.
    const sprintIssues = (await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
    })) as SprintIssue[];
    const issueIds = sprintIssues.map((s) => s.issueId);
    const issues = issueIds.length
      ? await prisma.issue.findMany({ where: { id: { in: issueIds } } })
      : [];
    const movedBack: string[] = [];
    for (const it of issues) {
      if (it.status !== 'DONE') movedBack.push(it.id);
    }
    if (movedBack.length > 0) {
      await prisma.sprintIssue.deleteMany({
        where: { sprintId: sprint.id, issueId: { in: movedBack } },
      });
    }

    const completedAt = new Date();
    // Atomic: guard against two concurrent complete requests — the WHERE state
    // clause means only one UPDATE will find a matching row.
    const { count } = await prisma.sprint.updateMany({
      where: { id: sprint.id, state: 'ACTIVE' },
      data: { state: 'COMPLETED', completedAt },
    });
    if (count === 0) {
      throw new AuthError('conflict', 'Sprint was already completed');
    }
    const updated = (await prisma.sprint.findUnique({ where: { id: sprint.id } }))! as Sprint;

    emit(SPRINT_EVENTS.COMPLETED, {
      sprintId: updated.id,
      projectId: updated.projectId,
      actorId: actor.id,
      completedAt,
      movedBackIssueIds: movedBack,
    });

    return updated;
  }

  // ------------------------------- listSprints -----------------------------

  async function listSprints(projectKey: string, actor: Actor): Promise<Sprint[]> {
    const { project } = await resolveProjectAccess(projectKey, 'VIEWER', actor);
    return (await prisma.sprint.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
    })) as Sprint[];
  }

  // ---------------------------- getActiveSprint ---------------------------

  type ColumnBoard = Record<IssueStatus, BoardIssue[]>;
  type BoardIssue = {
    id: string;
    key: string;
    title: string;
    status: IssueStatus;
    assigneeId: string | null;
    rank: number;
  };

  async function getActiveSprint(
    projectKey: string,
    actor: Actor,
  ): Promise<{ sprint: Sprint; columns: ColumnBoard } | null> {
    const { project } = await resolveProjectAccess(projectKey, 'VIEWER', actor);
    const sprint = (await prisma.sprint.findFirst({
      where: { projectId: project.id, state: 'ACTIVE' },
    })) as Sprint | null;
    if (!sprint) return null;
    const links = (await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    })) as SprintIssue[];
    const ids = links.map((l) => l.issueId);
    const issues = ids.length ? await prisma.issue.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(issues.map((i) => [i.id, i]));
    const columns: ColumnBoard = { TODO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] };
    for (const link of links) {
      const issue = byId.get(link.issueId);
      if (!issue) continue;
      columns[issue.status].push({
        id: issue.id,
        key: issue.key,
        title: issue.title,
        status: issue.status,
        assigneeId: issue.assigneeId,
        rank: link.rank,
      });
    }
    return { sprint, columns };
  }

  // ------------------------------- getBurndown -----------------------------

  type BurndownPoint = { date: string; remaining: number };

  async function getBurndown(sprintId: string, actor: Actor): Promise<BurndownPoint[]> {
    const sprint = await loadSprintOrThrow(sprintId);
    const projectKey = await projectKeyForSprint(sprint);
    await resolveProjectAccess(projectKey, 'VIEWER', actor);

    const links = (await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
    })) as SprintIssue[];
    const issueIds = links.map((l) => l.issueId);
    if (issueIds.length === 0) return [];

    const start = sprint.startDate ?? sprint.createdAt;
    const stop = sprint.completedAt ?? sprint.endDate ?? new Date();
    const days: string[] = [];
    {
      const cur = new Date(`${dayKey(start)}T00:00:00Z`);
      const last = new Date(`${dayKey(stop)}T00:00:00Z`);
      // Cap days to a sane upper bound to avoid runaway loops with bad dates.
      while (cur.getTime() <= last.getTime() && days.length < 366) {
        days.push(dayKey(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    // Status transition events for our issues.
    const events = (await prisma.activityLogEntry.findMany({
      where: { issueId: { in: issueIds }, field: 'status' },
      orderBy: { at: 'asc' },
    })) as Array<{
      issueId: string;
      before: string | null;
      after: string | null;
      at: Date;
    }>;

    // Snapshot current status as the "after" state if no event yet.
    const issues = await prisma.issue.findMany({ where: { id: { in: issueIds } } });
    const currentStatus = new Map(issues.map((i) => [i.id, i.status]));

    return days.map((dateStr) => {
      const cutoff = endOfDay(dateStr);
      const statusAtEod = new Map<string, IssueStatus>();
      for (const id of issueIds) {
        // Start from the current status, then walk events up to cutoff, taking
        // the LAST event whose at <= cutoff to determine end-of-day status. If
        // no event, fall back to the initial 'TODO' assumption (issues newly
        // created enter the sprint as TODO unless their first event says
        // otherwise).
        let s: IssueStatus = 'TODO';
        const eventsForIssue = events.filter(
          (e) => e.issueId === id && e.at.getTime() <= cutoff.getTime(),
        );
        if (eventsForIssue.length === 0) {
          // No transitions ≤ cutoff. Use the current status only if the issue
          // had no later transitions either — otherwise stick with 'TODO'.
          const anyLater = events.some((e) => e.issueId === id);
          s = anyLater ? 'TODO' : (currentStatus.get(id) ?? 'TODO');
        } else {
          const last = eventsForIssue[eventsForIssue.length - 1]!;
          s = (last.after as IssueStatus | null) ?? 'TODO';
        }
        statusAtEod.set(id, s);
      }
      let remaining = 0;
      for (const s of statusAtEod.values()) if (s !== 'DONE') remaining += 1;
      return { date: dateStr, remaining };
    });
  }

  return {
    createSprint,
    addIssueToSprint,
    removeIssueFromSprint,
    reorderSprintIssue,
    startSprint,
    completeSprint,
    listSprints,
    getActiveSprint,
    getBurndown,
  };
}

export type SprintsService = ReturnType<typeof createSprintsService>;
export type { Sprint, SprintIssue, SprintState };
