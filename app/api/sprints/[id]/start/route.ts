// POST /api/sprints/[id]/start — LEAD+ starts a sprint.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { badRequest, ok, toErrorResponse } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

async function handler(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let body: unknown = {};
  const text = await req.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return badRequest('Invalid JSON body');
    }
  }
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    const input = body as { startDate?: unknown; endDate?: unknown };
    const sprint = await svc.startSprint(
      id,
      {
        startDate: input.startDate ? new Date(String(input.startDate)) : undefined,
        endDate: input.endDate ? new Date(String(input.endDate)) : undefined,
      },
      { id: actor.id, role: actor.role },
    );
    return ok({ sprint });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, handler);
