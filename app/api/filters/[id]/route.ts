import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { deleteFilter } from "@/server/repo/filters";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/filters/:id — owner only (someone else's id reads as missing). */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  const r = await deleteFilter(id, user.id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
