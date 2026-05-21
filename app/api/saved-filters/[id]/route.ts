// PATCH /api/saved-filters/[id]
// DELETE /api/saved-filters/[id]

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSavedFiltersService } from '@/server/services/savedFilters';
import { noContent, ok, toErrorResponse, badRequest } from '@/lib/http';

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createSavedFiltersService({ prisma });
    const filter = await svc.updateFilter(id, body as Parameters<typeof svc.updateFilter>[1], {
      id: actor.id,
      role: actor.role,
    });
    return ok({ filter });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createSavedFiltersService({ prisma });
    await svc.deleteFilter(id, { id: actor.id, role: actor.role });
    return noContent();
  } catch (err) {
    return toErrorResponse(err);
  }
}
