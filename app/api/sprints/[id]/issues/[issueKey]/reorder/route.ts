// POST /api/sprints/[id]/issues/[issueKey]/reorder — MEMBER+ reorder.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { badRequest, ok, toErrorResponse } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

async function postHandler(
  req: Request,
  ctx: { params: Promise<{ id: string; issueKey: string }> },
): Promise<Response> {
  let body: unknown = {};
  const text = await req.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return badRequest('Invalid JSON body');
    }
  }
  try {
    const { id, issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    const input = body as { beforeIssueKey?: unknown };
    const row = await svc.reorderSprintIssue(
      {
        sprintId: id,
        issueKey,
        beforeIssueKey:
          input.beforeIssueKey !== undefined && input.beforeIssueKey !== null
            ? String(input.beforeIssueKey)
            : undefined,
      },
      { id: actor.id, role: actor.role },
    );
    return ok({ sprintIssue: row });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, postHandler);
