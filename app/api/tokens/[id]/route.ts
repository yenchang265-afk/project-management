import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { revokeToken } from "@/server/repo/tokens";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/tokens/:id — owner only (someone else's id reads as missing). */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  const ok = await revokeToken(id, user.id);
  if (!ok) return NextResponse.json({ success: false, error: "Token not found." }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
