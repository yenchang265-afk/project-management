// Minimal in-memory fake of the Prisma client surface that the projects service
// uses. Mirrors the pattern from tests/unit/services/auth/fakePrisma.ts and only
// implements the calls actually invoked by src/server/services/projects.

import type { Role } from '@prisma/client';

export type FakeUser = { id: string; email: string; name: string | null };

export type FakeOrgMembership = {
  id: string;
  userId: string;
  role: Role;
  createdAt: Date;
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
  createdAt: Date;
};

export type FakeIssueCounter = {
  projectId: string;
  lastNumber: number;
};

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

type ProjectWhere = { id?: string; key?: string };
type ProjectMemberWhere = {
  id?: string;
  projectId?: string;
  userId?: string;
  projectId_userId?: { projectId: string; userId: string };
};

type Op<T> = { equals?: T; in?: T[]; not?: T | null };

type ListWhere = {
  archivedAt?: null | Op<Date | null>;
  members?: { some?: { userId?: string } };
  id?: Op<string>;
};

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const orgMemberships = new Map<string, FakeOrgMembership>();
  const projects = new Map<string, FakeProject>();
  const projectMembers = new Map<string, FakeProjectMember>();
  const issueCounters = new Map<string, FakeIssueCounter>();

  function findProject(where: ProjectWhere): FakeProject | undefined {
    if (where.id) return projects.get(where.id);
    if (where.key) {
      for (const p of projects.values()) if (p.key === where.key) return p;
    }
    return undefined;
  }

  function findProjectMember(where: ProjectMemberWhere): FakeProjectMember | undefined {
    if (where.id) return projectMembers.get(where.id);
    if (where.projectId_userId) {
      const { projectId, userId } = where.projectId_userId;
      for (const m of projectMembers.values()) {
        if (m.projectId === projectId && m.userId === userId) return m;
      }
      return undefined;
    }
    if (where.projectId && where.userId) {
      for (const m of projectMembers.values()) {
        if (m.projectId === where.projectId && m.userId === where.userId) return m;
      }
    }
    return undefined;
  }

  const user = {
    create: async ({ data }: { data: { email: string; name?: string | null } }) => {
      const u: FakeUser = {
        id: nextId('user'),
        email: data.email,
        name: data.name ?? null,
      };
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
  };

  const orgMembership = {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      for (const m of orgMemberships.values()) {
        if (m.userId === where.userId) return m;
      }
      return null;
    },
    create: async ({ data }: { data: { userId: string; role: Role } }) => {
      const m: FakeOrgMembership = {
        id: nextId('orgmem'),
        userId: data.userId,
        role: data.role,
        createdAt: new Date(),
      };
      orgMemberships.set(m.id, m);
      return m;
    },
  };

  const project = {
    findUnique: async ({ where }: { where: ProjectWhere }) => findProject(where) ?? null,
    findFirst: async ({ where }: { where: ProjectWhere }) => findProject(where) ?? null,
    create: async ({
      data,
    }: {
      data: { key: string; name: string; description?: string | null; leadId: string };
    }) => {
      for (const p of projects.values()) {
        if (p.key === data.key) {
          const err = new Error('Unique constraint failed on the fields: (`key`)');
          (err as Error & { code?: string }).code = 'P2002';
          throw err;
        }
      }
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
    update: async ({
      where,
      data,
    }: {
      where: ProjectWhere;
      data: Partial<Pick<FakeProject, 'name' | 'description' | 'archivedAt'>>;
    }) => {
      const p = findProject(where);
      if (!p) throw new Error('Project not found');
      Object.assign(p, data, { updatedAt: new Date() });
      return p;
    },
    findMany: async ({
      where,
      orderBy: _orderBy,
    }: {
      where?: ListWhere;
      orderBy?: unknown;
    } = {}) => {
      let out = Array.from(projects.values());
      if (where) {
        if (where.archivedAt === null) {
          out = out.filter((p) => p.archivedAt === null);
        } else if (where.archivedAt && 'not' in where.archivedAt) {
          // no-op (we accept all)
        }
        if (where.members?.some?.userId) {
          const uid = where.members.some.userId;
          out = out.filter((p) => {
            for (const m of projectMembers.values()) {
              if (m.projectId === p.id && m.userId === uid) return true;
            }
            return false;
          });
        }
        if (where.id?.in) {
          const ids = new Set(where.id.in);
          out = out.filter((p) => ids.has(p.id));
        }
      }
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
  };

  const projectMember = {
    findUnique: async ({ where }: { where: ProjectMemberWhere }) =>
      findProjectMember(where) ?? null,
    findFirst: async ({ where }: { where: ProjectMemberWhere }) => findProjectMember(where) ?? null,
    findMany: async ({ where }: { where?: ProjectMemberWhere } = {}) => {
      let out = Array.from(projectMembers.values());
      if (where?.projectId) out = out.filter((m) => m.projectId === where.projectId);
      if (where?.userId) out = out.filter((m) => m.userId === where.userId);
      return out;
    },
    create: async ({ data }: { data: { projectId: string; userId: string; role: Role } }) => {
      const m: FakeProjectMember = {
        id: nextId('pmem'),
        projectId: data.projectId,
        userId: data.userId,
        role: data.role,
        createdAt: new Date(),
      };
      projectMembers.set(m.id, m);
      return m;
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
      if (typeof data.lastNumber === 'number') {
        c.lastNumber = data.lastNumber;
      } else if (data.lastNumber && 'increment' in data.lastNumber) {
        c.lastNumber += data.lastNumber.increment;
      }
      return c;
    },
    findUnique: async ({ where }: { where: { projectId: string } }) =>
      issueCounters.get(where.projectId) ?? null,
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
      $transaction,
      _state: { users, orgMemberships, projects, projectMembers, issueCounters },
    };
  }

  return bundle();
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
