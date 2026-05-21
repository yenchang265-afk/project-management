// POST /api/issues/[issueKey]/attachments — request presigned upload

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';
import { badRequest, created, toErrorResponse } from '@/lib/http';

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
  try {
    const { issueKey } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const result = await svc.attachFile(issueKey, body as Parameters<typeof svc.attachFile>[1], {
      id: actor.id,
      role: actor.role,
    });
    return created(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
