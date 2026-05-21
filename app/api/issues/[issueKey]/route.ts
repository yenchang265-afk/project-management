// GET    /api/issues/[issueKey] — fetch composed
// PATCH  /api/issues/[issueKey] — update allowed fields
// DELETE /api/issues/[issueKey] — delete (LEAD only)

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';
import { badRequest, noContent, ok, toErrorResponse } from '@/lib/http';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ issueKey: string }> },
): Promise<Response> {
  try {
    const { issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const issue = await svc.getIssue(issueKey, { id: actor.id, role: actor.role });
    return ok(issue);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ issueKey: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  try {
    const { issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const issue = await svc.updateIssue(issueKey, body as Parameters<typeof svc.updateIssue>[1], {
      id: actor.id,
      role: actor.role,
    });
    return ok({ issue });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ issueKey: string }> },
): Promise<Response> {
  try {
    const { issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    await svc.deleteIssue(issueKey, { id: actor.id, role: actor.role });
    return noContent();
  } catch (err) {
    return toErrorResponse(err);
  }
}
