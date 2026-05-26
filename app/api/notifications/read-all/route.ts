// POST /api/notifications/read-all — mark all of the actor's notifications read.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createNotificationService } from '@/server/services/notifications';
import { ok, toErrorResponse } from '@/lib/http';

export async function POST(): Promise<Response> {
  try {
    const actor = await requireUser();
    const svc = createNotificationService({ prisma });
    const result = await svc.markAllRead({ id: actor.id, role: actor.role });
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
