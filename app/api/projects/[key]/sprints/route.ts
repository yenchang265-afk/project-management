// GET  /api/projects/[key]/sprints — list sprints for a project
// POST /api/projects/[key]/sprints — create a sprint (LEAD+)

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { badRequest, created, ok, toErrorResponse } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    const sprints = await svc.listSprints(key, { id: actor.id, role: actor.role });
    return ok({ sprints });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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
    const svc = createSprintsService({ prisma });
    const input = body as { name?: unknown; goal?: unknown };
    const sprint = await svc.createSprint(
      {
        projectKey: key,
        name: String(input.name ?? ''),
        goal:
          input.goal !== undefined && input.goal !== null && input.goal !== ''
            ? String(input.goal)
            : undefined,
      },
      { id: actor.id, role: actor.role },
    );
    return created({ sprint });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, postHandler);
