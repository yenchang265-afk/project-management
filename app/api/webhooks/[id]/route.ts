import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { requirePerm } from "@/server/permissions";
import { deleteWebhook } from "@/server/repo/webhooks";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/webhooks/:id — PM only. */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const { id } = await ctx.params;
  const ok = await deleteWebhook(id);
  if (!ok) return NextResponse.json({ success: false, error: "Webhook not found." }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
