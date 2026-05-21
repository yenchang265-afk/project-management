// GET /api/projects/[key]/board — fetch the kanban board.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createBoardsService } from '@/server/services/boards';
import { ok, toErrorResponse } from '@/lib/http';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const actor = await requireUser();
    const svc = createBoardsService({ prisma });
    const board = await svc.getBoard(key, { id: actor.id, role: actor.role });
    return ok(board);
  } catch (err) {
    return toErrorResponse(err);
  }
}
