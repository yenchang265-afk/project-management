// POST /api/notifications/[id]/read — mark a single notification as read.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createNotificationService } from '@/server/services/notifications';
import { ok, toErrorResponse } from '@/lib/http';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createNotificationService({ prisma });
    const row = await svc.markAsRead(id, { id: actor.id, role: actor.role });
    return ok({ notification: row });
  } catch (err) {
    return toErrorResponse(err);
  }
}
