// GET   /api/notifications/preferences — get the full kind×channel matrix.
// PATCH /api/notifications/preferences — update one (kind, channel) pair.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createNotificationService } from '@/server/services/notifications';
import { badRequest, ok, toErrorResponse } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

export async function GET(): Promise<Response> {
  try {
    const actor = await requireUser();
    const svc = createNotificationService({ prisma });
    const prefs = await svc.getPreferences({ id: actor.id, role: actor.role });
    return ok({ preferences: prefs });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function patchHandler(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  try {
    const actor = await requireUser();
    const svc = createNotificationService({ prisma });
    const result = await svc.updatePreference(body as Parameters<typeof svc.updatePreference>[0], {
      id: actor.id,
      role: actor.role,
    });
    return ok({ preference: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const PATCH = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, patchHandler);
