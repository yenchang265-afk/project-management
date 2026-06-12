import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { requirePerm } from "@/server/permissions";
import { deleteFieldDef } from "@/server/repo/fields";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/fields/:id — PM only. Values already written into work-item
 *  events stay (the free-form custom-fields editor still shows them). */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteFieldDef(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
