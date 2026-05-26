// GET /api/notifications — list current user's notifications.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createNotificationService } from '@/server/services/notifications';
import { enqueueEmailNotification } from '@/server/jobs/queue';
import { ok, toErrorResponse } from '@/lib/http';

function getSvc() {
  return createNotificationService({
    prisma,
    enqueueEmail: async (job) => {
      await enqueueEmailNotification(job);
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  try {
    const actor = await requireUser();
    const url = new URL(req.url);
    const onlyUnread = url.searchParams.get('onlyUnread') === '1';
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const svc = getSvc();
    const page = await svc.listNotifications(
      { id: actor.id, role: actor.role },
      { onlyUnread, cursor, limit },
    );
    const unread = await svc.unreadCount({ id: actor.id, role: actor.role });
    return ok({ ...page, unreadCount: unread });
  } catch (err) {
    return toErrorResponse(err);
  }
}
