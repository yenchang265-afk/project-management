// In-memory fake of the Prisma surface used by the issues service.
// Mirrors the pattern from tests/unit/services/projects/fakePrisma.ts.
//
// Only the calls that the service actually invokes are implemented — any
// missing call should fail loudly with "not implemented" so tests don't pass
// against silent partial behavior.

import type { IssueLinkType, IssuePriority, IssueStatus, IssueType, Role } from '@prisma/client';

export type FakeUser = {
  id: string;
  email: string;
  name: string | null;
};

export type FakeOrgMembership = {
  id: string;
  userId: string;
  role: Role;
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

export type FakeIssueCounter = {
  projectId: string;
  lastNumber: number;
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

export type FakeLabel = {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: Date;
};

export type FakeIssueLabel = {
  issueId: string;
  labelId: string;
};

export type FakeComment = {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeAttachment = {
  id: string;
  issueId: string;
  uploaderId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  createdAt: Date;
};

export type FakeIssueLink = {
  id: string;
  fromIssueId: string;
  toIssueId: string;
  type: IssueLinkType;
  createdAt: Date;
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
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const orgMemberships = new Map<string, FakeOrgMembership>();
  const projects = new Map<string, FakeProject>();
  const projectMembers = new Map<string, FakeProjectMember>();
  const issueCounters = new Map<string, FakeIssueCounter>();
  const issues = new Map<string, FakeIssue>();
  const labels = new Map<string, FakeLabel>();
  const issueLabels = new Set<string>(); // composite issueId|labelId
  const comments = new Map<string, FakeComment>();
  const attachments = new Map<string, FakeAttachment>();
  const issueLinks = new Map<string, FakeIssueLink>();
  const activity = new Map<string, FakeActivity>();

  const user = {
    create: async ({ data }: { data: { email: string; name?: string | null } }) => {
      const u: FakeUser = { id: nextId('user'), email: data.email, name: data.name ?? null };
      users.set(u.id, u);
      return u;
    },
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return users.get(where.id) ?? null;
      if (where.email) {
        for (const u of users.values()) if (u.email === where.email) return u;
      }
      return null;
    },
    findMany: async (
      args: { where?: { id?: { in?: string[] }; email?: { in?: string[] } } } = {},
    ) => {
      let out = Array.from(users.values());
      if (args.where?.id?.in) {
        const ids = new Set(args.where.id.in);
        out = out.filter((u) => ids.has(u.id));
      }
      if (args.where?.email?.in) {
        const emails = new Set(args.where.email.in.map((e) => e.toLowerCase()));
        out = out.filter((u) => emails.has(u.email.toLowerCase()));
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
    findUnique: async ({ where }: { where: { userId: string } }) => {
      for (const m of orgMemberships.values()) if (m.userId === where.userId) return m;
      return null;
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
    findFirst: async ({ where }: { where: { id?: string; key?: string } }) => {
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
    findMany: async (args: { where?: { projectId?: string; userId?: string } } = {}) => {
      let out = Array.from(projectMembers.values());
      if (args.where?.projectId) out = out.filter((m) => m.projectId === args.where?.projectId);
      if (args.where?.userId) out = out.filter((m) => m.userId === args.where?.userId);
      return out;
    },
  };

  const issueCounter = {
    create: async ({ data }: { data: { projectId: string; lastNumber?: number } }) => {
      const c: FakeIssueCounter = {
        projectId: data.projectId,
        lastNumber: data.lastNumber ?? 0,
      };
      issueCounters.set(c.projectId, c);
      return c;
    },
    update: async ({
      where,
      data,
    }: {
      where: { projectId: string };
      data: { lastNumber?: number | { increment: number } };
    }) => {
      const c = issueCounters.get(where.projectId);
      if (!c) throw new Error('IssueCounter not found');
      if (typeof data.lastNumber === 'number') c.lastNumber = data.lastNumber;
      else if (data.lastNumber && 'increment' in data.lastNumber)
        c.lastNumber += data.lastNumber.increment;
      return { ...c };
    },
    findUnique: async ({ where }: { where: { projectId: string } }) =>
      issueCounters.get(where.projectId) ?? null,
  };

  // -------- issue --------

  type IssueWhere = {
    id?: string;
    key?: string;
    projectId?: string;
    status?: { in?: IssueStatus[] };
    priority?: { in?: IssuePriority[] };
    type?: { in?: IssueType[] };
    assigneeId?: string | null | { equals?: string | null };
    title?: { contains?: string; mode?: string };
  };

  const issue = {
    create: async ({ data }: { data: Omit<FakeIssue, 'id' | 'createdAt' | 'updatedAt'> }) => {
      const now = new Date();
      const i: FakeIssue = { id: nextId('iss'), createdAt: now, updatedAt: now, ...data };
      // unique key
      for (const existing of issues.values()) {
        if (existing.key === i.key) {
          const err = new Error('Unique constraint failed') as Error & { code?: string };
          err.code = 'P2002';
          throw err;
        }
      }
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
      else if (where.key) {
        for (const v of issues.values()) if (v.key === where.key) target = v;
      }
      if (!target) throw new Error('Issue not found');
      Object.assign(target, data, { updatedAt: new Date() });
      return { ...target };
    },
    findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
      if (where.id) return issues.get(where.id) ?? null;
      if (where.key) {
        for (const v of issues.values()) if (v.key === where.key) return v;
      }
      return null;
    },
    findFirst: async ({ where }: { where: { id?: string; key?: string } }) => {
      if (where.id) return issues.get(where.id) ?? null;
      if (where.key) {
        for (const v of issues.values()) if (v.key === where.key) return v;
      }
      return null;
    },
    findMany: async (
      args: {
        where?: IssueWhere & {
          AND?: IssueWhere[];
          OR?: IssueWhere[];
          labels?: { some?: { label?: { name?: { in?: string[] } } } };
        };
        orderBy?: Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
        take?: number;
        cursor?: { id?: string };
        skip?: number;
      } = {},
    ) => {
      let out = Array.from(issues.values());
      const w = args.where ?? {};
      if (w.projectId) out = out.filter((i) => i.projectId === w.projectId);
      if (w.status?.in) {
        const set = new Set(w.status.in);
        out = out.filter((i) => set.has(i.status));
      }
      if (w.priority?.in) {
        const set = new Set(w.priority.in);
        out = out.filter((i) => set.has(i.priority));
      }
      if (w.type?.in) {
        const set = new Set(w.type.in);
        out = out.filter((i) => set.has(i.type));
      }
      if (w.assigneeId !== undefined) {
        const aid = w.assigneeId;
        if (aid === null) {
          out = out.filter((i) => i.assigneeId === null);
        } else if (typeof aid === 'string') {
          out = out.filter((i) => i.assigneeId === aid);
        } else if (aid && typeof aid === 'object' && 'equals' in aid) {
          const eq = aid.equals ?? null;
          out = out.filter((i) => i.assigneeId === eq);
        }
      }
      if (w.title?.contains) {
        const needle = w.title.contains.toLowerCase();
        out = out.filter((i) => i.title.toLowerCase().includes(needle));
      }
      if (w.labels?.some?.label?.name?.in) {
        const wanted = new Set(w.labels.some.label.name.in);
        out = out.filter((i) => {
          for (const il of issueLabels) {
            const [issueId, labelId] = il.split('|');
            if (issueId !== i.id) continue;
            const lab = labelId ? labels.get(labelId) : undefined;
            if (lab && wanted.has(lab.name)) return true;
          }
          return false;
        });
      }
      // sort
      out.sort((a, b) => {
        const ord = args.orderBy?.[0];
        if (ord?.createdAt === 'desc') {
          const d = b.createdAt.getTime() - a.createdAt.getTime();
          if (d !== 0) return d;
        } else if (ord?.createdAt === 'asc') {
          const d = a.createdAt.getTime() - b.createdAt.getTime();
          if (d !== 0) return d;
        }
        if (ord?.id === 'desc') return b.id.localeCompare(a.id);
        return a.id.localeCompare(b.id);
      });
      if (args.cursor?.id) {
        const idx = out.findIndex((i) => i.id === args.cursor!.id);
        if (idx >= 0) out = out.slice(idx + (args.skip ?? 0));
      }
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    delete: async ({ where }: { where: { id?: string; key?: string } }) => {
      let target: FakeIssue | undefined;
      if (where.id) target = issues.get(where.id);
      else if (where.key) for (const v of issues.values()) if (v.key === where.key) target = v;
      if (!target) throw new Error('Issue not found');
      issues.delete(target.id);
      // Cascade comments, links, labels, attachments, activity
      for (const c of Array.from(comments.values())) {
        if (c.issueId === target.id) comments.delete(c.id);
      }
      for (const k of Array.from(issueLabels)) {
        if (k.startsWith(`${target.id}|`)) issueLabels.delete(k);
      }
      for (const l of Array.from(issueLinks.values())) {
        if (l.fromIssueId === target.id || l.toIssueId === target.id) issueLinks.delete(l.id);
      }
      for (const a of Array.from(attachments.values())) {
        if (a.issueId === target.id) attachments.delete(a.id);
      }
      for (const a of Array.from(activity.values())) {
        if (a.issueId === target.id) activity.delete(a.id);
      }
      return target;
    },
    count: async (
      args: {
        where?: IssueWhere;
      } = {},
    ) => {
      const list = await issue.findMany({ where: args.where as IssueWhere });
      return list.length;
    },
  };

  const label = {
    findFirst: async ({ where }: { where: { projectId?: string; name?: string } }) => {
      for (const l of labels.values()) {
        if (where.projectId && l.projectId !== where.projectId) continue;
        if (where.name && l.name !== where.name) continue;
        return l;
      }
      return null;
    },
    create: async ({ data }: { data: { projectId: string; name: string; color?: string } }) => {
      const l: FakeLabel = {
        id: nextId('lbl'),
        projectId: data.projectId,
        name: data.name,
        color: data.color ?? '#999999',
        createdAt: new Date(),
      };
      labels.set(l.id, l);
      return l;
    },
    findMany: async (args: { where?: { projectId?: string; id?: { in?: string[] } } } = {}) => {
      let out = Array.from(labels.values());
      if (args.where?.projectId) out = out.filter((l) => l.projectId === args.where?.projectId);
      if (args.where?.id?.in) {
        const ids = new Set(args.where.id.in);
        out = out.filter((l) => ids.has(l.id));
      }
      return out;
    },
  };

  const issueLabel = {
    create: async ({ data }: { data: { issueId: string; labelId: string } }) => {
      issueLabels.add(`${data.issueId}|${data.labelId}`);
      return data;
    },
    findMany: async (args: { where?: { issueId?: string } } = {}) => {
      const out: Array<{ issueId: string; labelId: string; label: FakeLabel | null }> = [];
      for (const k of issueLabels) {
        const [issueId, labelId] = k.split('|');
        if (!issueId || !labelId) continue;
        if (args.where?.issueId && issueId !== args.where.issueId) continue;
        out.push({ issueId, labelId, label: labels.get(labelId) ?? null });
      }
      return out;
    },
  };

  const comment = {
    create: async ({ data }: { data: { issueId: string; authorId: string; body: string } }) => {
      const now = new Date();
      const c: FakeComment = {
        id: nextId('cm'),
        issueId: data.issueId,
        authorId: data.authorId,
        body: data.body,
        createdAt: now,
        updatedAt: now,
      };
      comments.set(c.id, c);
      return c;
    },
    findMany: async (
      args: {
        where?: { issueId?: string };
        orderBy?: { createdAt?: 'asc' | 'desc' };
        take?: number;
        cursor?: { id?: string };
        skip?: number;
      } = {},
    ) => {
      let out = Array.from(comments.values());
      if (args.where?.issueId) out = out.filter((c) => c.issueId === args.where?.issueId);
      out.sort((a, b) =>
        args.orderBy?.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      if (args.cursor?.id) {
        const idx = out.findIndex((c) => c.id === args.cursor!.id);
        if (idx >= 0) out = out.slice(idx + (args.skip ?? 0));
      }
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
  };

  const attachment = {
    create: async ({ data }: { data: Omit<FakeAttachment, 'id' | 'createdAt'> }) => {
      const a: FakeAttachment = { id: nextId('att'), createdAt: new Date(), ...data };
      attachments.set(a.id, a);
      return a;
    },
    findUnique: async ({ where }: { where: { id: string } }) => attachments.get(where.id) ?? null,
    findMany: async (args: { where?: { issueId?: string } } = {}) => {
      let out = Array.from(attachments.values());
      if (args.where?.issueId) out = out.filter((a) => a.issueId === args.where?.issueId);
      return out;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const a = attachments.get(where.id);
      if (!a) throw new Error('Attachment not found');
      attachments.delete(where.id);
      return a;
    },
  };

  const issueLink = {
    create: async ({
      data,
    }: {
      data: { fromIssueId: string; toIssueId: string; type: IssueLinkType };
    }) => {
      // unique (from, to, type)
      for (const existing of issueLinks.values()) {
        if (
          existing.fromIssueId === data.fromIssueId &&
          existing.toIssueId === data.toIssueId &&
          existing.type === data.type
        ) {
          const err = new Error('Unique constraint failed') as Error & { code?: string };
          err.code = 'P2002';
          throw err;
        }
      }
      const l: FakeIssueLink = {
        id: nextId('lnk'),
        fromIssueId: data.fromIssueId,
        toIssueId: data.toIssueId,
        type: data.type,
        createdAt: new Date(),
      };
      issueLinks.set(l.id, l);
      return l;
    },
    findFirst: async ({
      where,
    }: {
      where: {
        fromIssueId?: string;
        toIssueId?: string;
        type?: IssueLinkType;
        OR?: Array<{ fromIssueId?: string; toIssueId?: string; type?: IssueLinkType }>;
      };
    }) => {
      const match = (l: FakeIssueLink, w: typeof where): boolean => {
        if (w.fromIssueId && l.fromIssueId !== w.fromIssueId) return false;
        if (w.toIssueId && l.toIssueId !== w.toIssueId) return false;
        if (w.type && l.type !== w.type) return false;
        return true;
      };
      for (const l of issueLinks.values()) {
        if (where.OR) {
          for (const branch of where.OR) {
            if (match(l, branch)) return l;
          }
        } else if (match(l, where)) {
          return l;
        }
      }
      return null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => issueLinks.get(where.id) ?? null,
    findMany: async (args: { where?: { fromIssueId?: string; toIssueId?: string } } = {}) => {
      let out = Array.from(issueLinks.values());
      if (args.where?.fromIssueId)
        out = out.filter((l) => l.fromIssueId === args.where?.fromIssueId);
      if (args.where?.toIssueId) out = out.filter((l) => l.toIssueId === args.where?.toIssueId);
      return out;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const l = issueLinks.get(where.id);
      if (!l) throw new Error('IssueLink not found');
      issueLinks.delete(where.id);
      return l;
    },
  };

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
      };
    }) => {
      const a: FakeActivity = {
        id: nextId('act'),
        issueId: data.issueId,
        actorId: data.actorId,
        field: data.field,
        before: data.before ?? null,
        after: data.after ?? null,
        at: new Date(),
      };
      activity.set(a.id, a);
      return a;
    },
    findMany: async (
      args: {
        where?: { issueId?: string };
        orderBy?: { at?: 'asc' | 'desc' };
        take?: number;
      } = {},
    ) => {
      let out = Array.from(activity.values());
      if (args.where?.issueId) out = out.filter((a) => a.issueId === args.where?.issueId);
      out.sort((a, b) =>
        args.orderBy?.at === 'asc'
          ? a.at.getTime() - b.at.getTime()
          : b.at.getTime() - a.at.getTime(),
      );
      if (args.take) out = out.slice(0, args.take);
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
      issueCounter,
      issue,
      label,
      issueLabel,
      comment,
      attachment,
      issueLink,
      activityLogEntry,
      $transaction,
      _state: {
        users,
        orgMemberships,
        projects,
        projectMembers,
        issueCounters,
        issues,
        labels,
        issueLabels,
        comments,
        attachments,
        issueLinks,
        activity,
      },
    };
  }

  return bundle();
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

// Helper to seed a minimal project + lead/member for tests
export async function seedProjectScaffolding(prisma: FakePrisma) {
  const lead = await prisma.user.create({ data: { email: 'lead@e.com', name: 'Lead' } });
  await prisma.orgMembership.create({ data: { userId: lead.id, role: 'LEAD' } });
  const member = await prisma.user.create({ data: { email: 'member@e.com', name: 'Member' } });
  await prisma.orgMembership.create({ data: { userId: member.id, role: 'MEMBER' } });
  const outsider = await prisma.user.create({ data: { email: 'outsider@e.com', name: 'Out' } });
  await prisma.orgMembership.create({ data: { userId: outsider.id, role: 'MEMBER' } });
  const project = await prisma.project.create({
    data: { key: 'ALPHA', name: 'Alpha', description: null, leadId: lead.id },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: lead.id, role: 'LEAD' },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: member.id, role: 'MEMBER' },
  });
  await prisma.issueCounter.create({ data: { projectId: project.id, lastNumber: 0 } });
  return { lead, member, outsider, project };
}
