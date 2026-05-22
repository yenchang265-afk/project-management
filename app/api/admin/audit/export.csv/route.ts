// GET /api/admin/audit/export.csv — streaming CSV export.
//
// Admin-only. Accepts the same filters as /api/admin/audit (no cursor — we
// stream everything that matches). Output is text/csv with a
// `Content-Disposition: attachment` header so the browser triggers a save.

import { toErrorResponse } from '@/lib/http';
import { requireUserWithRole } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createAuditService, type CsvWriter } from '@/server/services/audit';

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

    const svc = createAuditService({ prisma });

    // Buffer the full CSV before responding so any DB error can be returned as
    // a proper error response rather than a silently truncated file.
    const chunks: string[] = [];
    const writer: CsvWriter = { write: (chunk: string) => { chunks.push(chunk); } };
    await svc.exportAuditEventsCsv({ filters: { kind, actorId, from, to } }, writer);
    const csv = chunks.join('');

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="audit-events.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
