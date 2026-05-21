// POST /api/sprints/[id]/complete — LEAD+ completes an active sprint.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { ok, toErrorResponse } from '@/lib/http';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    const sprint = await svc.completeSprint(id, { id: actor.id, role: actor.role });
    return ok({ sprint });
  } catch (err) {
    return toErrorResponse(err);
  }
}
