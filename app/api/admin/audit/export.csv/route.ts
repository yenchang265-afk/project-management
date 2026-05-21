// GET /api/admin/audit/export.csv — streaming CSV export.
//
// Admin-only. Accepts the same filters as /api/admin/audit (no cursor — we
// stream everything that matches). Output is text/csv with a
// `Content-Disposition: attachment` header so the browser triggers a save.

import { AuthError } from '@/lib/errors';
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

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const writer: CsvWriter = {
          write: (chunk: string) => {
            controller.enqueue(encoder.encode(chunk));
          },
        };
        try {
          await svc.exportAuditEventsCsv({ filters: { kind, actorId, from, to } }, writer);
          controller.close();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[audit] CSV export failed', err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="audit-events.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return toErrorResponse(err);
    return toErrorResponse(err);
  }
}
