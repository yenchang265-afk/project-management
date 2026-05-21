// GET  /api/saved-filters?projectId=
// POST /api/saved-filters  body { name, projectId?, query }

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSavedFiltersService } from '@/server/services/savedFilters';
import { created, ok, toErrorResponse, badRequest } from '@/lib/http';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const actor = await requireUser();
    const svc = createSavedFiltersService({ prisma });
    const projectId = url.searchParams.get('projectId') ?? undefined;
    const filters = await svc.listFilters(
      { id: actor.id, role: actor.role },
      projectId ? { projectId } : {},
    );
    return ok({ data: filters });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  try {
    const actor = await requireUser();
    const svc = createSavedFiltersService({ prisma });
    const filter = await svc.createFilter(body as Parameters<typeof svc.createFilter>[0], {
      id: actor.id,
      role: actor.role,
    });
    return created({ filter });
  } catch (err) {
    return toErrorResponse(err);
  }
}
