// GET /api/projects/[key]/backlog — list backlog (TODO) issues with optional
// filter chips + cursor pagination. Query string mirrors /issues filters.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createBoardsService } from '@/server/services/boards';
import { ok, toErrorResponse } from '@/lib/http';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const url = new URL(req.url);
    const actor = await requireUser();
    const svc = createBoardsService({ prisma });
    const parseArray = (name: string) => url.searchParams.getAll(name);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const result = await svc.getBacklog(
      {
        projectKey: key,
        filters: {
          priority: parseArray('priority').length ? (parseArray('priority') as never) : undefined,
          type: parseArray('type').length ? (parseArray('type') as never) : undefined,
          labelNames: parseArray('labelNames').length ? parseArray('labelNames') : undefined,
          assigneeId: url.searchParams.get('assigneeId') ?? undefined,
          query: url.searchParams.get('query') ?? undefined,
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
