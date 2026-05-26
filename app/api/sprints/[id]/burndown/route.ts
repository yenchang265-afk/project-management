// GET /api/sprints/[id]/burndown — VIEWER+ reads the burndown series.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { ok, toErrorResponse } from '@/lib/http';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    const series = await svc.getBurndown(id, { id: actor.id, role: actor.role });
    return ok({ series });
  } catch (err) {
    return toErrorResponse(err);
  }
}
