// In-memory fake of the Prisma surface used by the Sprints service.
// Follows the same pattern as tests/unit/services/issues/__support__/fakePrisma.ts.
//
// Only the surface that the Sprints service actually calls is implemented.
// We model the partial unique index `active_sprint_per_project` in `create`
// and `update` so unit tests can exercise the DB-level guard end-to-end.

import type { IssueStatus, Role, SprintState } from '@prisma/client';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export type FakeUser = { id: string; email: string; name: string | null };
export type FakeOrgMembership = { id: string; userId: string; role: Role };
export type FakeProject = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type FakeProjectMember = {
  id: string;
  projectId: string;
  userId: string;
  role: Role;
};
export type FakeIssue = {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  status: IssueStatus;
  reporterId: string;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type FakeSprint = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  state: SprintState;
  startDate: Date | null;
  endDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type FakeSprintIssue = {
  sprintId: string;
  issueId: string;
  rank: number;
};
export type FakeActivity = {
  id: string;
  issueId: string;
  actorId: string;
  field: string;
  before: string | null;
  after: string | null;
  at: Date;
};

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const orgMemberships = new Map<string, FakeOrgMembership>();
  const projects = new Map<string, FakeProject>();
  const projectMembers = new Map<string, FakeProjectMember>();
  const issues = new Map<string, FakeIssue>();
  const sprints = new Map<string, FakeSprint>();
  const sprintIssues = new Map<string, FakeSprintIssue>(); // key = sprintId|issueId
  const activity = new Map<string, FakeActivity>();

  function uniqueKey(s: FakeSprintIssue) {
    return `${s.sprintId}|${s.issueId}`;
  }

  function enforceActiveSprintUnique(projectId: string, exceptId?: string): void {
    let count = 0;
    for (const s of sprints.values()) {
      if (s.projectId !== projectId) continue;
      if (s.state !== 'ACTIVE') continue;
      if (exceptId && s.id === exceptId) continue;
      count += 1;
    }
    if (count > 0) {
      const err = new Error('Unique constraint failed (active_sprint_per_project)') as Error & {
        code?: string;
        meta?: { target?: string };
      };
      err.code = 'P2002';
      err.meta = { target: 'active_sprint_per_project' };
      throw err;
    }
  }

  const user = {
    create: async ({ data }: { data: { email: string; name?: string | null } }) => {
      const u: FakeUser = { id: nextId('user'), email: data.email, name: data.name ?? null };
      users.set(u.id, u);
      return u;
    },
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return users.get(where.id) ?? null;
      if (where.email) for (const u of users.values()) if (u.email === where.email) return u;
      return null;
    },
    findMany: async (args: { where?: { id?: { in?: string[] } } } = {}) => {
      let out = Array.from(users.values());
      if (args.where?.id?.in) {
        const ids = new Set(args.where.id.in);
        out = out.filter((u) => ids.has(u.id));
      }
      return out;
    },
  };

  const orgMembership = {
    create: async ({ data }: { data: { userId: string; role: Role } }) => {
      const m: FakeOrgMembership = { id: nextId('om'), userId: data.userId, role: data.role };
      orgMemberships.set(m.id, m);
      return m;
    },
  };

  const project = {
    create: async ({
      data,
    }: {
      data: { key: string; name: string; description?: string | null; leadId: string };
    }) => {
      const now = new Date();
      const p: FakeProject = {
        id: nextId('proj'),
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        leadId: data.leadId,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      projects.set(p.id, p);
      return p;
    },
    findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
      if (where.id) return projects.get(where.id) ?? null;
      if (where.key) for (const p of projects.values()) if (p.key === where.key) return p;
      return null;
    },
  };

  const projectMember = {
    create: async ({ data }: { data: { projectId: string; userId: string; role: Role } }) => {
      const m: FakeProjectMember = {
        id: nextId('pm'),
        projectId: data.projectId,
        userId: data.userId,
        role: data.role,
      };
      projectMembers.set(m.id, m);
      return m;
    },
    findFirst: async ({ where }: { where: { projectId?: string; userId?: string } }) => {
      for (const m of projectMembers.values()) {
        if (where.projectId && m.projectId !== where.projectId) continue;
        if (where.userId && m.userId !== where.userId) continue;
        return m;
      }
      return null;
    },
  };

  const issue = {
    create: async ({
      data,
    }: {
      data: Omit<FakeIssue, 'id' | 'createdAt' | 'updatedAt'> & {
        createdAt?: Date;
        updatedAt?: Date;
      };
    }) => {
      const now = new Date();
      const i: FakeIssue = {
        id: nextId('iss'),
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
        projectId: data.projectId,
        number: data.number,
        key: data.key,
        title: data.title,
        status: data.status,
        reporterId: data.reporterId,
        assigneeId: data.assigneeId ?? null,
      };
      issues.set(i.id, i);
      return i;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id?: string; key?: string };
      data: Partial<FakeIssue>;
    }) => {
      let target: FakeIssue | undefined;
      if (where.id) target = issues.get(where.id);
      else if (where.key) for (const v of issues.values()) if (v.key === where.key) target = v;
      if (!target) throw new Error('Issue not found');
      Object.assign(target, data, { updatedAt: new Date() });
      return { ...target };
    },
    findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
      if (where.id) return issues.get(where.id) ?? null;
      if (where.key) for (const v of issues.values()) if (v.key === where.key) return v;
      return null;
    },
    findMany: async (
      args: {
        where?: {
          id?: { in?: string[] };
          projectId?: string;
          status?: { in?: IssueStatus[] };
        };
      } = {},
    ) => {
      let out = Array.from(issues.values());
      if (args.where?.id?.in) {
        const ids = new Set(args.where.id.in);
        out = out.filter((i) => ids.has(i.id));
      }
      if (args.where?.projectId) {
        out = out.filter((i) => i.projectId === args.where?.projectId);
      }
      if (args.where?.status?.in) {
        const s = new Set(args.where.status.in);
        out = out.filter((i) => s.has(i.status));
      }
      return out;
    },
  };

  const sprint = {
    create: async ({
      data,
    }: {
      data: {
        projectId: string;
        name: string;
        goal?: string | null;
        state?: SprintState;
        startDate?: Date | null;
        endDate?: Date | null;
        completedAt?: Date | null;
      };
    }) => {
      const now = new Date();
      const s: FakeSprint = {
        id: nextId('spr'),
        projectId: data.projectId,
        name: data.name,
        goal: data.goal ?? null,
        state: data.state ?? 'PLANNED',
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        completedAt: data.completedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      if (s.state === 'ACTIVE') enforceActiveSprintUnique(s.projectId);
      sprints.set(s.id, s);
      return s;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeSprint> }) => {
      const target = sprints.get(where.id);
      if (!target) throw new Error('Sprint not found');
      const next = { ...target, ...data, updatedAt: new Date() } as FakeSprint;
      if (next.state === 'ACTIVE') enforceActiveSprintUnique(next.projectId, target.id);
      sprints.set(target.id, next);
      return { ...next };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; state?: SprintState };
      data: Partial<FakeSprint>;
    }) => {
      let count = 0;
      for (const s of sprints.values()) {
        if (where.id && s.id !== where.id) continue;
        if (where.state && s.state !== where.state) continue;
        const next = { ...s, ...data, updatedAt: new Date() } as FakeSprint;
        if (next.state === 'ACTIVE') enforceActiveSprintUnique(next.projectId, s.id);
        sprints.set(s.id, next);
        count += 1;
      }
      return { count };
    },
    findUnique: async ({ where }: { where: { id: string } }) => sprints.get(where.id) ?? null,
    findFirst: async ({
      where,
    }: {
      where: { projectId?: string; state?: SprintState; id?: { not?: string } };
    }) => {
      for (const s of sprints.values()) {
        if (where.projectId && s.projectId !== where.projectId) continue;
        if (where.state && s.state !== where.state) continue;
        if (where.id?.not && s.id === where.id.not) continue;
        return s;
      }
      return null;
    },
    findMany: async (
      args: {
        where?: { projectId?: string; state?: SprintState | { in?: SprintState[] } };
        orderBy?: { createdAt?: 'asc' | 'desc' };
      } = {},
    ) => {
      let out = Array.from(sprints.values());
      if (args.where?.projectId) out = out.filter((s) => s.projectId === args.where?.projectId);
      if (args.where?.state) {
        const st = args.where.state;
        if (typeof st === 'string') out = out.filter((s) => s.state === st);
        else if (st.in) {
          const set = new Set(st.in);
          out = out.filter((s) => set.has(s.state));
        }
      }
      out.sort((a, b) =>
        args.orderBy?.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return out;
    },
  };

  const sprintIssue = {
    create: async ({ data }: { data: { sprintId: string; issueId: string; rank: number } }) => {
      const key = `${data.sprintId}|${data.issueId}`;
      if (sprintIssues.has(key)) {
        const err = new Error('Unique constraint failed') as Error & { code?: string };
        err.code = 'P2002';
        throw err;
      }
      // enforce (sprintId, rank) uniqueness
      for (const s of sprintIssues.values()) {
        if (s.sprintId === data.sprintId && s.rank === data.rank) {
          const err = new Error('Unique constraint failed (rank)') as Error & { code?: string };
          err.code = 'P2002';
          throw err;
        }
      }
      const s: FakeSprintIssue = {
        sprintId: data.sprintId,
        issueId: data.issueId,
        rank: data.rank,
      };
      sprintIssues.set(key, s);
      return s;
    },
    update: async ({
      where,
      data,
    }: {
      where: { sprintId_issueId: { sprintId: string; issueId: string } };
      data: Partial<FakeSprintIssue>;
    }) => {
      const key = `${where.sprintId_issueId.sprintId}|${where.sprintId_issueId.issueId}`;
      const target = sprintIssues.get(key);
      if (!target) throw new Error('SprintIssue not found');
      const next = { ...target, ...data };
      // rank uniqueness
      if (data.rank !== undefined) {
        for (const [k, s] of sprintIssues) {
          if (k === key) continue;
          if (s.sprintId === next.sprintId && s.rank === next.rank) {
            const err = new Error('Unique constraint failed (rank)') as Error & {
              code?: string;
            };
            err.code = 'P2002';
            throw err;
          }
        }
      }
      sprintIssues.set(key, next);
      return { ...next };
    },
    findUnique: async ({
      where,
    }: {
      where: { sprintId_issueId: { sprintId: string; issueId: string } };
    }) => {
      const key = `${where.sprintId_issueId.sprintId}|${where.sprintId_issueId.issueId}`;
      return sprintIssues.get(key) ?? null;
    },
    findFirst: async ({
      where,
    }: {
      where: { sprintId?: string; issueId?: string; sprint?: { projectId?: string } };
    }) => {
      for (const s of sprintIssues.values()) {
        if (where.sprintId && s.sprintId !== where.sprintId) continue;
        if (where.issueId && s.issueId !== where.issueId) continue;
        if (where.sprint?.projectId) {
          const spr = sprints.get(s.sprintId);
          if (!spr || spr.projectId !== where.sprint.projectId) continue;
        }
        return s;
      }
      return null;
    },
    findMany: async (
      args: {
        where?: { sprintId?: string; issueId?: { in?: string[] } };
        orderBy?: { rank?: 'asc' | 'desc' };
      } = {},
    ) => {
      let out = Array.from(sprintIssues.values());
      if (args.where?.sprintId) out = out.filter((s) => s.sprintId === args.where?.sprintId);
      if (args.where?.issueId?.in) {
        const set = new Set(args.where.issueId.in);
        out = out.filter((s) => set.has(s.issueId));
      }
      out.sort((a, b) => (args.orderBy?.rank === 'desc' ? b.rank - a.rank : a.rank - b.rank));
      return out;
    },
    delete: async ({
      where,
    }: {
      where: { sprintId_issueId: { sprintId: string; issueId: string } };
    }) => {
      const key = `${where.sprintId_issueId.sprintId}|${where.sprintId_issueId.issueId}`;
      const target = sprintIssues.get(key);
      if (!target) throw new Error('SprintIssue not found');
      sprintIssues.delete(key);
      return target;
    },
    deleteMany: async (args: { where?: { sprintId?: string; issueId?: { in?: string[] } } }) => {
      let n = 0;
      for (const [k, s] of Array.from(sprintIssues)) {
        if (args.where?.sprintId && s.sprintId !== args.where.sprintId) continue;
        if (args.where?.issueId?.in && !args.where.issueId.in.includes(s.issueId)) continue;
        sprintIssues.delete(k);
        n += 1;
      }
      return { count: n };
    },
    count: async (args: { where?: { sprintId?: string } } = {}) => {
      let n = 0;
      for (const s of sprintIssues.values()) {
        if (args.where?.sprintId && s.sprintId !== args.where.sprintId) continue;
        n += 1;
      }
      return n;
    },
  };

  void uniqueKey;

  const activityLogEntry = {
    create: async ({
      data,
    }: {
      data: {
        issueId: string;
        actorId: string;
        field: string;
        before?: string | null;
        after?: string | null;
        at?: Date;
      };
    }) => {
      const a: FakeActivity = {
        id: nextId('act'),
        issueId: data.issueId,
        actorId: data.actorId,
        field: data.field,
        before: data.before ?? null,
        after: data.after ?? null,
        at: data.at ?? new Date(),
      };
      activity.set(a.id, a);
      return a;
    },
    findMany: async (
      args: {
        where?: {
          issueId?: { in?: string[] } | string;
          field?: string;
          at?: { lte?: Date; gte?: Date };
        };
        orderBy?: { at?: 'asc' | 'desc' };
      } = {},
    ) => {
      let out = Array.from(activity.values());
      const w = args.where ?? {};
      if (w.issueId) {
        if (typeof w.issueId === 'string') out = out.filter((a) => a.issueId === w.issueId);
        else if (w.issueId.in) {
          const set = new Set(w.issueId.in);
          out = out.filter((a) => set.has(a.issueId));
        }
      }
      if (w.field) out = out.filter((a) => a.field === w.field);
      if (w.at?.lte) out = out.filter((a) => a.at.getTime() <= w.at!.lte!.getTime());
      if (w.at?.gte) out = out.filter((a) => a.at.getTime() >= w.at!.gte!.getTime());
      out.sort((a, b) =>
        args.orderBy?.at === 'desc'
          ? b.at.getTime() - a.at.getTime()
          : a.at.getTime() - b.at.getTime(),
      );
      return out;
    },
  };

  async function $transaction<T>(fn: (tx: ReturnType<typeof bundle>) => Promise<T>): Promise<T> {
    return fn(bundle());
  }

  function bundle() {
    return {
      user,
      orgMembership,
      project,
      projectMember,
      issue,
      sprint,
      sprintIssue,
      activityLogEntry,
      $transaction,
      _state: {
        users,
        projects,
        projectMembers,
        issues,
        sprints,
        sprintIssues,
        activity,
      },
    };
  }

  return bundle();
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

export async function seedSprintScaffolding(prisma: FakePrisma) {
  const lead = await prisma.user.create({ data: { email: 'lead@s.com', name: 'Lead' } });
  await prisma.orgMembership.create({ data: { userId: lead.id, role: 'LEAD' } });
  const member = await prisma.user.create({ data: { email: 'mem@s.com', name: 'Member' } });
  await prisma.orgMembership.create({ data: { userId: member.id, role: 'MEMBER' } });
  const outsider = await prisma.user.create({ data: { email: 'out@s.com', name: 'Out' } });
  await prisma.orgMembership.create({ data: { userId: outsider.id, role: 'MEMBER' } });
  const project = await prisma.project.create({
    data: { key: 'SPR', name: 'Sprint Project', leadId: lead.id },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: lead.id, role: 'LEAD' },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: member.id, role: 'MEMBER' },
  });
  return { lead, member, outsider, project };
}

export async function seedIssue(
  prisma: FakePrisma,
  projectId: string,
  reporterId: string,
  number: number,
  status: IssueStatus = 'TODO',
  key = `SPR-${number}`,
) {
  return prisma.issue.create({
    data: {
      projectId,
      number,
      key,
      title: `Issue ${number}`,
      status,
      reporterId,
      assigneeId: null,
    },
  });
}
