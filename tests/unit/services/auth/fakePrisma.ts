// Minimal in-memory fake of the Prisma client surface that the auth service uses.
// Not a general-purpose mock — only the calls invoked by src/server/services/auth.
import type { Role } from '@prisma/client';

export type FakeUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
  image: string | null;
  passwordHash: string | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeMembership = {
  id: string;
  userId: string;
  role: Role;
  createdAt: Date;
};

type UserWhere = {
  id?: string;
  email?: string;
  passwordResetToken?: string;
};

type UserCreateData = {
  email: string;
  name?: string | null;
  passwordHash?: string | null;
};

type UserUpdateData = Partial<{
  name: string | null;
  passwordHash: string | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
}>;

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const memberships = new Map<string, FakeMembership>();

  function findUser(where: UserWhere): FakeUser | undefined {
    if (where.id) return users.get(where.id);
    for (const u of users.values()) {
      if (where.email && u.email === where.email) return u;
      if (where.passwordResetToken && u.passwordResetToken === where.passwordResetToken) return u;
    }
    return undefined;
  }

  const user = {
    findUnique: async ({ where }: { where: UserWhere }) => findUser(where) ?? null,
    findFirst: async ({ where }: { where: UserWhere }) => findUser(where) ?? null,
    create: async ({ data }: { data: UserCreateData }) => {
      for (const u of users.values()) {
        if (u.email === data.email) {
          const err = new Error('Unique constraint failed on the fields: (`email`)');
          // Mimic Prisma's known-request-error shape just enough for the service.
          (err as Error & { code?: string }).code = 'P2002';
          throw err;
        }
      }
      const now = new Date();
      const u: FakeUser = {
        id: nextId('user'),
        email: data.email,
        name: data.name ?? null,
        emailVerified: null,
        image: null,
        passwordHash: data.passwordHash ?? null,
        passwordResetToken: null,
        passwordResetExpires: null,
        createdAt: now,
        updatedAt: now,
      };
      users.set(u.id, u);
      return u;
    },
    update: async ({ where, data }: { where: UserWhere; data: UserUpdateData }) => {
      const u = findUser(where);
      if (!u) throw new Error('Record to update not found');
      Object.assign(u, data, { updatedAt: new Date() });
      return u;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: UserWhere & { passwordResetToken?: string };
      data: UserUpdateData;
    }) => {
      let count = 0;
      for (const u of users.values()) {
        if (where.id && u.id !== where.id) continue;
        if (where.email && u.email !== where.email) continue;
        if (
          where.passwordResetToken !== undefined &&
          u.passwordResetToken !== where.passwordResetToken
        )
          continue;
        Object.assign(u, data, { updatedAt: new Date() });
        count += 1;
      }
      return { count };
    },
  };

  const orgMembership = {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      for (const m of memberships.values()) {
        if (m.userId === where.userId) return m;
      }
      return null;
    },
    create: async ({ data }: { data: { userId: string; role: Role } }) => {
      const m: FakeMembership = {
        id: nextId('mem'),
        userId: data.userId,
        role: data.role,
        createdAt: new Date(),
      };
      memberships.set(m.id, m);
      return m;
    },
  };

  return {
    user,
    orgMembership,
    _state: { users, memberships },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
