// DELETE /api/sprints/[id]/issues/[issueKey] — MEMBER+ removes issue from sprint.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { noContent, toErrorResponse } from '@/lib/http';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';

async function handler(
  _req: Request,
  ctx: { params: Promise<{ id: string; issueKey: string }> },
): Promise<Response> {
  try {
    const { id, issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createSprintsService({ prisma });
    await svc.removeIssueFromSprint({ sprintId: id, issueKey }, { id: actor.id, role: actor.role });
    return noContent();
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const DELETE = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, handler);
