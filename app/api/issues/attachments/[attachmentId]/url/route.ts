// GET /api/issues/attachments/[attachmentId]/url — presigned download URL

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';
import { ok, toErrorResponse } from '@/lib/http';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  try {
    const { attachmentId } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    const url = await svc.getAttachmentDownloadUrl(attachmentId, {
      id: actor.id,
      role: actor.role,
    });
    return ok({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
