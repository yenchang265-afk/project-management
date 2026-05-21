// Minimal Prisma fake for SavedFilter unit tests.
// Implements only `savedFilter.*`, plus `project`/`projectMember` so that the
// service can authorize project-scoped filters.

import type { Role } from '@prisma/client';

export type FakeSavedFilter = {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  query: unknown;
  createdAt: Date;
  updatedAt: Date;
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

let counter = 0;
function nextId(p: string): string {
  counter += 1;
  return `${p}_${counter}`;
}

export function createFakePrisma() {
  const savedFilters = new Map<string, FakeSavedFilter>();
  const projects = new Map<string, FakeProject>();
  const projectMembers = new Map<string, FakeProjectMember>();

  const savedFilter = {
    create: async ({
      data,
    }: {
      data: { userId: string; projectId?: string | null; name: string; query: unknown };
    }) => {
      const now = new Date();
      const row: FakeSavedFilter = {
        id: nextId('sf'),
        userId: data.userId,
        projectId: data.projectId ?? null,
        name: data.name,
        query: data.query,
        createdAt: now,
        updatedAt: now,
      };
      savedFilters.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) => savedFilters.get(where.id) ?? null,
    findMany: async (
      args: {
        where?: { userId?: string; projectId?: string | null };
        orderBy?: { createdAt?: 'asc' | 'desc' };
      } = {},
    ) => {
      let out = Array.from(savedFilters.values());
      if (args.where?.userId) out = out.filter((r) => r.userId === args.where?.userId);
      if (args.where?.projectId !== undefined) {
        out = out.filter((r) => r.projectId === args.where?.projectId);
      }
      out.sort((a, b) =>
        args.orderBy?.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return out;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Pick<FakeSavedFilter, 'name' | 'query'>>;
    }) => {
      const row = savedFilters.get(where.id);
      if (!row) throw new Error('Not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const row = savedFilters.get(where.id);
      if (!row) throw new Error('Not found');
      savedFilters.delete(where.id);
      return row;
    },
  };

  const project = {
    create: async ({ data }: { data: { key: string; name: string; leadId: string } }) => {
      const now = new Date();
      const p: FakeProject = {
        id: nextId('proj'),
        key: data.key,
        name: data.name,
        description: null,
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
      const m: FakeProjectMember = { id: nextId('pm'), ...data };
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

  return { savedFilter, project, projectMember };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
