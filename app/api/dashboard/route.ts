// GET /api/dashboard — thin shim over the dashboard read-model service.
// Auth: 401 for anonymous; otherwise composes per-user payload.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createDashboardService } from '@/server/services/dashboard';
import { ok, toErrorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request): Promise<Response> {
  try {
    const actor = await requireUser();
    const svc = createDashboardService({ prisma });
    const data = await svc.getDashboardData({ id: actor.id, role: actor.role });
    return ok(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
