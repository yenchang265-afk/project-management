// POST /api/projects/[key]/board/move — body { issueKey, toStatus }.

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createBoardsService } from '@/server/services/boards';
import { ok, toErrorResponse, badRequest } from '@/lib/http';
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
    await ctx.params; // key is informational; service derives project from issueKey
    const actor = await requireUser();
    const svc = createBoardsService({ prisma });
    const b = body as { issueKey?: string; toStatus?: string };
    if (!b?.issueKey || !b?.toStatus) {
      return badRequest('issueKey and toStatus are required');
    }
    const issue = await svc.moveIssueOnBoard(
      { issueKey: b.issueKey, toStatus: b.toStatus as never },
      { id: actor.id, role: actor.role },
    );
    return ok({ issue });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, postHandler);
