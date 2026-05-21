// POST /api/sprints/[id]/issues — MEMBER+ adds an issue to a sprint.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { badRequest, created, toErrorResponse } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

async function handler(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    const input = body as { issueKey?: unknown };
    const row = await svc.addIssueToSprint(
      { sprintId: id, issueKey: String(input.issueKey ?? '') },
      { id: actor.id, role: actor.role },
    );
    return created({ sprintIssue: row });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, handler);
