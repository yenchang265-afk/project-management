// Dashboard / Home read-model service (Phase 4d).
//
// Pure read composition over existing tables — NO schema additions, NO writes,
// NO event emission. Surfaces what an authenticated user needs on `/dashboard`:
//
//   - assignedToMe   : latest 10 non-DONE issues where assigneeId = actor.id,
//                       scoped to projects the actor can access.
//   - recentActivity : latest 20 ActivityLogEntry rows across accessible
//                       projects, enriched with issue key/title and actor name.
//   - projectTiles   : every non-archived project visible to the actor, with
//                       { openIssues, doneThisWeek } counts.
//
// Project visibility mirrors `listProjects` in src/server/services/projects:
//   - ADMIN sees all projects.
//   - Everyone else sees projects where they have a ProjectMember row.
//
// `doneThisWeek` is derived from ActivityLogEntry status transitions whose
// `after` is "DONE" in the last 7 days — this matches the "most recent
// transition to DONE" intent in the plan and avoids creating a new column.

import type {
  ActivityLogEntry,
  Issue,
  PrismaClient,
  Project,
  ProjectMember,
  Role,
  User,
} from '@prisma/client';

export type Actor = { id: string; role: Role };

export type DashboardServiceDeps = {
  prisma: PrismaClient;
};

export type AssignedIssue = Pick<
  Issue,
  'id' | 'key' | 'title' | 'priority' | 'status' | 'type' | 'dueDate' | 'assigneeId' | 'createdAt'
>;

export type RecentActivityEntry = {
  id: string;
  field: string;
  before: string | null;
  after: string | null;
  at: Date;
  issueKey: string;
  issueTitle: string;
  actorId: string;
  actorName: string | null;
};

export type ProjectTile = {
  id: string;
  key: string;
  name: string;
  leadId: string;
  leadName: string | null;
  openIssues: number;
  doneThisWeek: number;
};

export type DashboardData = {
  assignedToMe: AssignedIssue[];
  recentActivity: RecentActivityEntry[];
  projectTiles: ProjectTile[];
};

const ASSIGNED_LIMIT = 10;
const ACTIVITY_LIMIT = 20;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const OPEN_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] as const;

export function createDashboardService(deps: DashboardServiceDeps) {
  const { prisma } = deps;

  // List the IDs of projects the actor can see. Mirrors the visibility rules
  // in projects.listProjects: ADMIN → all (non-archived), everyone else → only
  // projects they are a ProjectMember of.
  async function accessibleProjects(actor: Actor): Promise<Project[]> {
    if (actor.role === 'ADMIN') {
      return prisma.project.findMany({
        where: { archivedAt: null },
        orderBy: { key: 'asc' },
      });
    }
    const memberships = (await prisma.projectMember.findMany({
      where: { userId: actor.id },
    })) as ProjectMember[];
    if (memberships.length === 0) return [];
    const ids = memberships.map((m) => m.projectId);
    return prisma.project.findMany({
      where: { id: { in: ids }, archivedAt: null },
      orderBy: { key: 'asc' },
    });
  }

  async function getDashboardData(actor: Actor): Promise<DashboardData> {
    const projects = await accessibleProjects(actor);

    if (projects.length === 0) {
      return { assignedToMe: [], recentActivity: [], projectTiles: [] };
    }

    const projectIds = projects.map((p) => p.id);
    const weekAgo = new Date(Date.now() - ONE_WEEK_MS);

    // Fire all the per-section queries in parallel. The activity and DONE
    // queries are scoped to accessible project IDs in the WHERE clause so
    // no row leaks across the project boundary in memory.
    const [assignedRaw, activityRaw, openCountsRaw, doneCountsRaw, leadUsers] =
      await Promise.all([
        prisma.issue.findMany({
          where: {
            assigneeId: actor.id,
            status: { not: 'DONE' },
            projectId: { in: projectIds },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: ASSIGNED_LIMIT,
        }) as Promise<Issue[]>,
        prisma.activityLogEntry.findMany({
          where: { issue: { projectId: { in: projectIds } } },
          orderBy: { at: 'desc' },
          take: ACTIVITY_LIMIT,
        }) as Promise<ActivityLogEntry[]>,
        Promise.all(
          projects.map((p) =>
            prisma.issue.count({
              where: { projectId: p.id, status: { in: [...OPEN_STATUSES] } },
            }),
          ),
        ),
        Promise.all(
          projects.map((p) =>
            prisma.activityLogEntry.findMany({
              where: {
                field: 'status',
                after: 'DONE',
                at: { gte: weekAgo },
                issue: { projectId: p.id },
              },
            }) as Promise<ActivityLogEntry[]>,
          ),
        ),
        prisma.user.findMany({
          where: { id: { in: projects.map((p) => p.leadId) } },
        }) as Promise<User[]>,
      ]);

    // Hydrate activity entries with their issue + actor metadata. Single
    // batch lookups keep this O(2) extra queries instead of N+1.
    const issueIds = Array.from(new Set(activityRaw.map((a) => a.issueId)));
    const actorIds = Array.from(new Set(activityRaw.map((a) => a.actorId)));
    const [activityIssues, activityActors] = await Promise.all([
      issueIds.length > 0
        ? (prisma.issue.findMany({ where: { id: { in: issueIds } } }) as Promise<Issue[]>)
        : Promise.resolve<Issue[]>([]),
      actorIds.length > 0
        ? (prisma.user.findMany({ where: { id: { in: actorIds } } }) as Promise<User[]>)
        : Promise.resolve<User[]>([]),
    ]);
    const issueById = new Map(activityIssues.map((i) => [i.id, i] as const));
    const actorById = new Map(activityActors.map((u) => [u.id, u] as const));

    const recentActivity: RecentActivityEntry[] = activityRaw.map((a) => {
      const issue = issueById.get(a.issueId);
      const user = actorById.get(a.actorId);
      return {
        id: a.id,
        field: a.field,
        before: a.before,
        after: a.after,
        at: a.at,
        issueKey: issue?.key ?? '',
        issueTitle: issue?.title ?? '',
        actorId: a.actorId,
        actorName: user?.name ?? user?.email ?? null,
      };
    });

    const assignedToMe: AssignedIssue[] = assignedRaw.map((i) => ({
      id: i.id,
      key: i.key,
      title: i.title,
      priority: i.priority,
      status: i.status,
      type: i.type,
      dueDate: i.dueDate,
      assigneeId: i.assigneeId,
      createdAt: i.createdAt,
    }));

    const leadById = new Map(leadUsers.map((u) => [u.id, u] as const));
    const projectTiles: ProjectTile[] = projects.map((p, idx) => {
      const lead = leadById.get(p.leadId);
      // doneCountsRaw[idx] is the array of "transition to DONE" entries within
      // the last 7 days for this project. We dedupe by issueId so an issue
      // that bounced TODO→DONE→TODO→DONE within the week still counts once.
      const doneIssueIds = new Set<string>();
      for (const entry of doneCountsRaw[idx] ?? []) {
        doneIssueIds.add(entry.issueId);
      }
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        leadId: p.leadId,
        leadName: lead?.name ?? lead?.email ?? null,
        openIssues: openCountsRaw[idx] ?? 0,
        doneThisWeek: doneIssueIds.size,
      };
    });

    return { assignedToMe, recentActivity, projectTiles };
  }

  return { getDashboardData };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
