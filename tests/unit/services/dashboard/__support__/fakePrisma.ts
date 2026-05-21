// In-memory Prisma fake for the dashboard service unit tests.
//
// The dashboard service is *read-only*. It needs:
//   - prisma.projectMember.findMany     ({ where: { userId } })            → list accessible projects
//   - prisma.project.findMany           ({ where: { id: { in } } })        → resolve project metadata
//   - prisma.issue.findMany             ({ where: { assigneeId, status: { not: 'DONE' }, projectId: { in } }, orderBy, take, include })
//   - prisma.issue.count                ({ where: { projectId, status: { in } } }) — openIssues
//   - prisma.activityLogEntry.findMany  ({ where: { issue: { projectId: { in } } }, orderBy, take, include })
//   - prisma.user.findMany              ({ where: { id: { in } } })
//
// Only the minimum surface is implemented. Missing methods throw loudly.

import type { IssuePriority, IssueStatus, IssueType, Role } from '@prisma/client';

export type FakeUser = {
  id: string;
  email: string;
  name: string | null;
};

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
  description: string | null;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  assigneeId: string | null;
  reporterId: string;
  dueDate: Date | null;
  estimate: number | null;
  createdAt: Date;
  updatedAt: Date;
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

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

type IdInWhere = { in?: string[] };
type StringInWhere = { in?: string[]; not?: string | null; equals?: string | null };
type StatusWhere = { in?: IssueStatus[]; not?: IssueStatus };

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const projects = new Map<string, FakeProject>();
  const projectMembers = new Map<string, FakeProjectMember>();
  const issues = new Map<string, FakeIssue>();
  const activity = new Map<string, FakeActivity>();

  const user = {
    findMany: async (
      args: { where?: { id?: IdInWhere } } = {},
    ): Promise<FakeUser[]> => {
      let out = Array.from(users.values());
      if (args.where?.id?.in) {
        const ids = new Set(args.where.id.in);
        out = out.filter((u) => ids.has(u.id));
      }
      return out.map((u) => ({ ...u }));
    },
  };

  const project = {
    findMany: async (
      args: {
        where?: { id?: IdInWhere; archivedAt?: null };
        orderBy?: { key?: 'asc' | 'desc' };
      } = {},
    ): Promise<FakeProject[]> => {
      let out = Array.from(projects.values());
      if (args.where?.id?.in) {
        const ids = new Set(args.where.id.in);
        out = out.filter((p) => ids.has(p.id));
      }
      if (args.where?.archivedAt === null) {
        out = out.filter((p) => p.archivedAt === null);
      }
      if (args.orderBy?.key === 'desc') {
        out.sort((a, b) => b.key.localeCompare(a.key));
      } else {
        out.sort((a, b) => a.key.localeCompare(b.key));
      }
      return out.map((p) => ({ ...p }));
    },
  };

  const projectMember = {
    findMany: async (
      args: { where?: { userId?: string; projectId?: string } } = {},
    ): Promise<FakeProjectMember[]> => {
      let out = Array.from(projectMembers.values());
      if (args.where?.userId) out = out.filter((m) => m.userId === args.where?.userId);
      if (args.where?.projectId)
        out = out.filter((m) => m.projectId === args.where?.projectId);
      return out.map((m) => ({ ...m }));
    },
  };

  type IssueWhere = {
    assigneeId?: string | null;
    status?: IssueStatus | StatusWhere;
    projectId?: string | { in?: string[] };
  };

  const issue = {
    findMany: async (
      args: {
        where?: IssueWhere;
        orderBy?: Array<{ createdAt?: 'asc' | 'desc'; updatedAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
        take?: number;
      } = {},
    ): Promise<FakeIssue[]> => {
      let out = Array.from(issues.values());
      const w = args.where ?? {};
      if (w.assigneeId !== undefined) {
        out = out.filter((i) => i.assigneeId === w.assigneeId);
      }
      if (w.status !== undefined) {
        if (typeof w.status === 'string') {
          out = out.filter((i) => i.status === w.status);
        } else {
          if (w.status.in) {
            const set = new Set(w.status.in);
            out = out.filter((i) => set.has(i.status));
          }
          if (w.status.not) {
            out = out.filter((i) => i.status !== w.status!.not);
          }
        }
      }
      if (w.projectId !== undefined) {
        if (typeof w.projectId === 'string') {
          out = out.filter((i) => i.projectId === w.projectId);
        } else if (w.projectId.in) {
          const set = new Set(w.projectId.in);
          out = out.filter((i) => set.has(i.projectId));
        }
      }
      const ord = args.orderBy?.[0] ?? {};
      out.sort((a, b) => {
        if (ord.createdAt === 'desc') {
          const d = b.createdAt.getTime() - a.createdAt.getTime();
          if (d !== 0) return d;
        } else if (ord.createdAt === 'asc') {
          const d = a.createdAt.getTime() - b.createdAt.getTime();
          if (d !== 0) return d;
        }
        if (ord.updatedAt === 'desc') {
          const d = b.updatedAt.getTime() - a.updatedAt.getTime();
          if (d !== 0) return d;
        }
        if (ord.id === 'desc') return b.id.localeCompare(a.id);
        return a.id.localeCompare(b.id);
      });
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out.map((i) => ({ ...i }));
    },
    count: async (args: { where?: IssueWhere } = {}): Promise<number> => {
      const list = await issue.findMany({ where: args.where });
      return list.length;
    },
  };

  type ActivityWhere = {
    issueId?: string;
    field?: string | { equals?: string; in?: string[] };
    after?: string;
    at?: { gte?: Date; lte?: Date };
    issue?: { projectId?: string | { in?: string[] } };
  };

  const activityLogEntry = {
    findMany: async (
      args: {
        where?: ActivityWhere;
        orderBy?: { at?: 'asc' | 'desc' };
        take?: number;
      } = {},
    ): Promise<FakeActivity[]> => {
      let out = Array.from(activity.values());
      const w = args.where ?? {};
      if (w.issueId) out = out.filter((a) => a.issueId === w.issueId);
      if (w.field !== undefined) {
        if (typeof w.field === 'string') {
          out = out.filter((a) => a.field === w.field);
        } else if (w.field.equals) {
          const val = w.field.equals;
          out = out.filter((a) => a.field === val);
        } else if (w.field.in) {
          const set = new Set(w.field.in);
          out = out.filter((a) => set.has(a.field));
        }
      }
      if (w.after !== undefined) {
        out = out.filter((a) => a.after === w.after);
      }
      if (w.at?.gte) {
        const gte = w.at.gte;
        out = out.filter((a) => a.at.getTime() >= gte.getTime());
      }
      if (w.at?.lte) {
        const lte = w.at.lte;
        out = out.filter((a) => a.at.getTime() <= lte.getTime());
      }
      if (w.issue?.projectId !== undefined) {
        const pid = w.issue.projectId;
        const allowed = new Set<string>();
        if (typeof pid === 'string') {
          for (const i of issues.values()) if (i.projectId === pid) allowed.add(i.id);
        } else if (pid.in) {
          const pset = new Set(pid.in);
          for (const i of issues.values()) if (pset.has(i.projectId)) allowed.add(i.id);
        }
        out = out.filter((a) => allowed.has(a.issueId));
      }
      const ord = args.orderBy ?? {};
      out.sort((a, b) =>
        ord.at === 'asc'
          ? a.at.getTime() - b.at.getTime()
          : b.at.getTime() - a.at.getTime(),
      );
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out.map((a) => ({ ...a }));
    },
  };

  function bundle() {
    return {
      user,
      project,
      projectMember,
      issue,
      activityLogEntry,
      _state: { users, projects, projectMembers, issues, activity },
    };
  }

  return bundle();
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

// --- seed helpers ---

export type SeededUser = FakeUser;

export async function seedUser(prisma: FakePrisma, email: string, name = email): Promise<FakeUser> {
  const u: FakeUser = { id: nextId('user'), email, name };
  prisma._state.users.set(u.id, u);
  return u;
}

export async function seedProject(
  prisma: FakePrisma,
  key: string,
  leadId: string,
  archived = false,
): Promise<FakeProject> {
  const now = new Date();
  const p: FakeProject = {
    id: nextId('proj'),
    key,
    name: key,
    description: null,
    leadId,
    archivedAt: archived ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  prisma._state.projects.set(p.id, p);
  return p;
}

export async function seedMember(
  prisma: FakePrisma,
  projectId: string,
  userId: string,
  role: Role = 'MEMBER',
): Promise<FakeProjectMember> {
  const m: FakeProjectMember = { id: nextId('pmem'), projectId, userId, role };
  prisma._state.projectMembers.set(m.id, m);
  return m;
}

let issueNumberCounter = 0;
export async function seedIssue(
  prisma: FakePrisma,
  projectId: string,
  projectKey: string,
  fields: Partial<FakeIssue> & { title: string; reporterId: string },
): Promise<FakeIssue> {
  issueNumberCounter += 1;
  const num = fields.number ?? issueNumberCounter;
  const now = new Date();
  const i: FakeIssue = {
    id: nextId('iss'),
    projectId,
    number: num,
    key: `${projectKey}-${num}`,
    title: fields.title,
    description: fields.description ?? null,
    type: fields.type ?? 'TASK',
    priority: fields.priority ?? 'MEDIUM',
    status: fields.status ?? 'TODO',
    assigneeId: fields.assigneeId ?? null,
    reporterId: fields.reporterId,
    dueDate: fields.dueDate ?? null,
    estimate: fields.estimate ?? null,
    createdAt: fields.createdAt ?? now,
    updatedAt: fields.updatedAt ?? now,
  };
  prisma._state.issues.set(i.id, i);
  return i;
}

export async function seedActivity(
  prisma: FakePrisma,
  fields: Partial<FakeActivity> & {
    issueId: string;
    actorId: string;
    field: string;
  },
): Promise<FakeActivity> {
  const a: FakeActivity = {
    id: nextId('act'),
    issueId: fields.issueId,
    actorId: fields.actorId,
    field: fields.field,
    before: fields.before ?? null,
    after: fields.after ?? null,
    at: fields.at ?? new Date(),
  };
  prisma._state.activity.set(a.id, a);
  return a;
}
