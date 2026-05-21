// DELETE /api/issues/attachments/[attachmentId] — remove attachment

import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';
import { noContent, toErrorResponse } from '@/lib/http';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  try {
    const { attachmentId } = await ctx.params;
    const actor = await requireUser();
    const svc = createIssuesService({ prisma });
    await svc.removeAttachment(attachmentId, { id: actor.id, role: actor.role });
    return noContent();
  } catch (err) {
    return toErrorResponse(err);
  }
}
