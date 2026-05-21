// Minimal in-memory Prisma fake for the audit service unit tests.
// Mirrors the pattern used by the notifications fakePrisma.

export type FakeAuditEvent = {
  id: string;
  actorId: string | null;
  kind: string;
  target: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  at: Date;
};

export type FakeUser = {
  id: string;
  email: string;
};

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

type FindManyArgs = {
  where?: {
    kind?: string;
    actorId?: string;
    at?: { gte?: Date; lte?: Date };
    OR?: Array<{
      at?: { lt?: Date };
      AND?: Array<{ at?: { equals?: Date }; id?: { lt?: string } }>;
    }>;
  };
  orderBy?: Array<{ at?: 'asc' | 'desc'; id?: 'asc' | 'desc' }> | { at?: 'asc' | 'desc' };
  take?: number;
  skip?: number;
  cursor?: { id: string };
};

export function createFakePrisma(opts: { failCreate?: boolean } = {}) {
  const events: FakeAuditEvent[] = [];
  const users: FakeUser[] = [];

  const auditEvent = {
    create: async ({
      data,
    }: {
      data: {
        actorId?: string | null;
        kind: string;
        target?: string | null;
        payload: unknown;
        ip?: string | null;
        userAgent?: string | null;
        at?: Date;
      };
    }): Promise<FakeAuditEvent> => {
      if (opts.failCreate) {
        throw new Error('simulated prisma failure');
      }
      const row: FakeAuditEvent = {
        id: nextId('aud'),
        actorId: data.actorId ?? null,
        kind: data.kind,
        target: data.target ?? null,
        payload: data.payload,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        at: data.at ?? new Date(Date.now() + events.length),
      };
      events.push(row);
      return { ...row };
    },
    findMany: async (args: FindManyArgs = {}): Promise<FakeAuditEvent[]> => {
      let out = events.slice();
      const w = args.where;
      if (w?.kind) out = out.filter((e) => e.kind === w.kind);
      if (w?.actorId) out = out.filter((e) => e.actorId === w.actorId);
      if (w?.at?.gte) out = out.filter((e) => e.at.getTime() >= w.at!.gte!.getTime());
      if (w?.at?.lte) out = out.filter((e) => e.at.getTime() <= w.at!.lte!.getTime());
      if (w?.OR) {
        // Cursor: at < lastAt OR (at = lastAt AND id < lastId). Tolerant matching.
        out = out.filter((e) => {
          for (const clause of w.OR!) {
            if (clause.at?.lt && e.at.getTime() < clause.at.lt.getTime()) return true;
            if (clause.AND) {
              const eqAt = clause.AND.find((c) => c.at?.equals);
              const ltId = clause.AND.find((c) => c.id?.lt);
              if (
                eqAt?.at?.equals &&
                e.at.getTime() === eqAt.at.equals.getTime() &&
                ltId?.id?.lt &&
                e.id < ltId.id.lt
              )
                return true;
            }
          }
          return false;
        });
      }
      // Apply ordering: default at desc, then id desc
      out.sort((a, b) => {
        const at = b.at.getTime() - a.at.getTime();
        if (at !== 0) return at;
        return b.id.localeCompare(a.id);
      });
      if (args.cursor) {
        const idx = out.findIndex((e) => e.id === args.cursor!.id);
        if (idx >= 0) out = out.slice(idx + (args.skip ?? 0));
      }
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out.map((e) => ({ ...e }));
    },
    count: async ({ where }: { where?: FindManyArgs['where'] } = {}): Promise<number> => {
      let out = events.slice();
      if (where?.kind) out = out.filter((e) => e.kind === where.kind);
      if (where?.actorId) out = out.filter((e) => e.actorId === where.actorId);
      return out.length;
    },
  };

  const user = {
    findMany: async ({
      where,
      select,
    }: {
      where?: { id?: { in?: string[] } };
      select?: { id?: boolean; email?: boolean };
    }): Promise<Array<Pick<FakeUser, 'id' | 'email'>>> => {
      let out = users.slice();
      if (where?.id?.in) {
        const ids = new Set(where.id.in);
        out = out.filter((u) => ids.has(u.id));
      }
      return out.map((u) => {
        const r: { id?: string; email?: string } = {};
        if (!select || select.id) r.id = u.id;
        if (!select || select.email) r.email = u.email;
        return r as Pick<FakeUser, 'id' | 'email'>;
      });
    },
  };

  return {
    auditEvent,
    user,
    _state: { events, users },
    _addUser: (id: string, email: string) => {
      users.push({ id, email });
    },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
