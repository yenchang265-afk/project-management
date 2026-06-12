import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { requirePerm } from "@/server/permissions";
import { deleteForm } from "@/server/repo/forms";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/forms/:id — PM only; kills the public link. */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteForm(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
