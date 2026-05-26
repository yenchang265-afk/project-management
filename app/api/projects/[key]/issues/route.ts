// POST /api/projects/[key]/issues — create
// GET  /api/projects/[key]/issues — list with filters + cursor

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';
import { created, ok, toErrorResponse, badRequest } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

async function postHandler(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  try {
    const { key } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const issue = await svc.createIssue(
      { ...(body as Record<string, unknown>), projectKey: key } as Parameters<
        typeof svc.createIssue
      >[0],
      { id: actor.id, role: actor.role },
    );
    return created({ issue });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, postHandler);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const url = new URL(req.url);
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const parseArray = (name: string) => url.searchParams.getAll(name);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const input = {
      projectKey: key,
      status: parseArray('status').length ? (parseArray('status') as never) : undefined,
      priority: parseArray('priority').length ? (parseArray('priority') as never) : undefined,
      type: parseArray('type').length ? (parseArray('type') as never) : undefined,
      labelNames: parseArray('labelNames').length ? parseArray('labelNames') : undefined,
      assigneeId: url.searchParams.get('assigneeId') ?? undefined,
      query: url.searchParams.get('query') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit,
    };
    const result = await svc.listIssues(input as Parameters<typeof svc.listIssues>[0], {
      id: actor.id,
      role: actor.role,
    });
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
