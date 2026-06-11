import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { PatchSprintSchema } from "@/server/sprint-schemas";
import { updateSprint } from "@/server/repo/sprints";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_sprints");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, PatchSprintSchema);
  if (!body.ok) return body.res;
  const r = await updateSprint(id, {
    ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
    ...(body.data.start !== undefined ? { start: body.data.start } : {}),
    ...(body.data.end !== undefined ? { end: body.data.end } : {}),
    ...(body.data.state !== undefined ? { state: body.data.state } : {}),
  });
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
