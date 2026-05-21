// GET /api/admin/audit — paginated list of audit events.
//
// Admin-only. Query parameters:
//   - kind:      exact match (e.g. "auth.register")
//   - actorId:   exact match
//   - from / to: ISO timestamps, inclusive on `at`
//   - cursor:    opaque id from the previous page
//   - limit:     1..200 (default 50)

import { AuthError } from '@/lib/errors';
import { ok, toErrorResponse, badRequest } from '@/lib/http';
import { requireUserWithRole } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createAuditService } from '@/server/services/audit';

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request): Promise<Response> {
  try {
    await requireUserWithRole('ADMIN');
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind') ?? undefined;
    const actorId = url.searchParams.get('actorId') ?? undefined;
    const from = parseDate(url.searchParams.get('from'));
    const to = parseDate(url.searchParams.get('to'));
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limitRaw = url.searchParams.get('limit');
    let limit: number | undefined;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || n <= 0) {
        return badRequest('limit must be a positive integer');
      }
      limit = n;
    }

    const svc = createAuditService({ prisma });
    const page = await svc.listAuditEvents({
      filters: { kind, actorId, from, to },
      cursor,
      limit,
    });
    return ok(page);
  } catch (err) {
    if (err instanceof AuthError) return toErrorResponse(err);
    return toErrorResponse(err);
  }
}
