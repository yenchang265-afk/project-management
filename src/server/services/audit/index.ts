// Audit log domain service (Phase 5a).
//
// Append-only org-level audit log for auth events (login / register / password
// reset), project changes (create / rename / archive), and role changes. The
// per-issue audit trail lives in ActivityLogEntry (Phase 3) and is NOT
// duplicated here.
//
// Responsibilities:
//   - recordAuditEvent: fire-and-forget write. Never throws to caller.
//   - listAuditEvents: cursor-paginated read for the admin view.
//   - exportAuditEventsCsv: streaming CSV export (admin), pages through Prisma
//     in chunks of 1000 so memory stays bounded.
//
// Design notes:
//   - The service is pure: it accepts a `prisma` dep so it can be unit-tested
//     with an in-memory fake.
//   - Cursor pagination uses (at, id) — order is `at DESC, id DESC` so the
//     newest events appear first. The cursor is the row's id; we re-derive
//     the `at` from the row when paging.
//   - The CSV writer is duck-typed (`{ write(string|Buffer) }`) so callers can
//     pass either a Node Writable, a Web WritableStreamDefaultWriter wrapper,
//     or the small CollectingWriter used in unit tests.

import type { AuditEvent, PrismaClient } from '@prisma/client';

export type AuditServiceDeps = {
  prisma: PrismaClient;
};

export type RecordAuditEventInput = {
  kind: string;
  actorId?: string | null;
  target?: string | null;
  payload: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditEventFilters = {
  kind?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
};

export type ListAuditEventsInput = {
  filters?: AuditEventFilters;
  cursor?: string;
  limit?: number;
};

export type ListAuditEventsResult = {
  data: AuditEvent[];
  pageInfo: {
    nextCursor: string | null;
    hasMore: boolean;
  };
};

export type CsvWriter = {
  write: (chunk: string) => unknown;
  end?: () => unknown;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const EXPORT_PAGE_SIZE = 1000;

function buildWhere(filters?: AuditEventFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filters?.kind) where.kind = filters.kind;
  if (filters?.actorId) where.actorId = filters.actorId;
  if (filters?.from || filters?.to) {
    const at: { gte?: Date; lte?: Date } = {};
    if (filters.from) at.gte = filters.from;
    if (filters.to) at.lte = filters.to;
    where.at = at;
  }
  return where;
}

/** RFC 4180 CSV escape: wrap in quotes if it contains ",", quote, CR or LF;
 * double any inner quotes. Always returns a safe field. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (s.length === 0) return '';
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatRow(row: AuditEvent, emailByActor: Map<string, string>): string {
  return [
    csvEscape(row.id),
    csvEscape(row.at.toISOString()),
    csvEscape(row.kind),
    csvEscape(row.actorId ?? ''),
    csvEscape(row.actorId ? (emailByActor.get(row.actorId) ?? '') : ''),
    csvEscape(row.target ?? ''),
    csvEscape(JSON.stringify(row.payload ?? null)),
  ].join(',');
}

export function createAuditService(deps: AuditServiceDeps) {
  const { prisma } = deps;

  async function recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEvent | null> {
    try {
      const row = await prisma.auditEvent.create({
        data: {
          kind: input.kind,
          actorId: input.actorId ?? null,
          target: input.target ?? null,
          payload: (input.payload ?? {}) as never,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
      return row;
    } catch (err) {
      // Best-effort: never throw to caller. Audit failures must not break the
      // domain mutation that triggered them.
      // eslint-disable-next-line no-console
      console.error('[audit] recordAuditEvent failed', err);
      return null;
    }
  }

  async function listAuditEvents(input: ListAuditEventsInput): Promise<ListAuditEventsResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where = buildWhere(input.filters);

    const rows = (await prisma.auditEvent.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    })) as AuditEvent[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
    return { data, pageInfo: { nextCursor, hasMore } };
  }

  async function exportAuditEventsCsv(
    input: { filters?: AuditEventFilters },
    writer: CsvWriter,
  ): Promise<void> {
    writer.write('id,at,kind,actorId,actorEmail,target,payload\n');
    const where = buildWhere(input.filters);

    let cursor: string | undefined;
    // Page through Prisma in fixed chunks so memory stays bounded.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = (await prisma.auditEvent.findMany({
        where,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })) as AuditEvent[];

      if (rows.length === 0) break;

      // Resolve actor emails for this page only (bounded join).
      const actorIds = Array.from(
        new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x)),
      );
      const emailByActor = new Map<string, string>();
      if (actorIds.length > 0) {
        const users = (await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })) as Array<{ id: string; email: string }>;
        for (const u of users) emailByActor.set(u.id, u.email);
      }

      // Stream this chunk as one write.
      const chunk = rows.map((r) => formatRow(r, emailByActor)).join('\n') + '\n';
      writer.write(chunk);

      if (rows.length < EXPORT_PAGE_SIZE) break;
      cursor = rows[rows.length - 1]!.id;
    }
    if (writer.end) writer.end();
  }

  return {
    recordAuditEvent,
    listAuditEvents,
    exportAuditEventsCsv,
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
