// POST /api/issues/[issueKey]/transition — body { to: IssueStatus }

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';
import { badRequest, ok, toErrorResponse } from '@/lib/http';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ issueKey: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  const to = (body as { to?: string }).to;
  if (!to) return badRequest('Missing "to" status');
  try {
    const { issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const issue = await svc.transitionIssue(issueKey, to as never, {
      id: actor.id,
      role: actor.role,
    });
    return ok({ issue });
  } catch (err) {
    return toErrorResponse(err);
  }
}
