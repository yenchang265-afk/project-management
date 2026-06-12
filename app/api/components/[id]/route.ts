import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { requirePerm } from "@/server/permissions";
import { deleteComponent } from "@/server/repo/registries";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/components/:id — PM only. Work items keep their component
 *  strings (the registry only feeds the picker). */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteComponent(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
