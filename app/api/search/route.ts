// GET /api/search — full-text search over issues for a single project.
// Params: q, projectKey, plus filter params (status/priority/type/...).

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSearchService } from '@/server/services/search';
import { ok, toErrorResponse, badRequest } from '@/lib/http';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectKey = url.searchParams.get('projectKey');
    if (!projectKey) return badRequest('projectKey is required');
    const actor = await requireUser();
    const svc = createSearchService({ prisma });
    const parseArray = (name: string) => url.searchParams.getAll(name);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const result = await svc.searchIssues(
      {
        projectKey,
        q: url.searchParams.get('q') ?? '',
        filters: {
          status: parseArray('status').length ? (parseArray('status') as never) : undefined,
          priority: parseArray('priority').length ? (parseArray('priority') as never) : undefined,
          type: parseArray('type').length ? (parseArray('type') as never) : undefined,
          labelNames: parseArray('labelNames').length ? parseArray('labelNames') : undefined,
          assigneeId: url.searchParams.get('assigneeId') ?? undefined,
        },
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit,
      },
      { id: actor.id, role: actor.role },
    );
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
