import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { deleteScheme, updateScheme } from "@/server/repo/workflows";
import { TransitionWireSchema } from "../route";

type Ctx = { params: Promise<{ id: string }> };

const UpdateSchemeSchema = z.object({
  name: z.string().min(2).max(128),
  transitions: z.array(TransitionWireSchema).min(1).max(200),
}).strict();

/** PATCH /api/workflow-schemes/:id — replace name + transition table (PM, validated). */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_workflows");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, UpdateSchemeSchema);
  if (!body.ok) return body.res;
  const r = await updateScheme(id, body.data.name.trim(), body.data.transitions);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});

/** DELETE /api/workflow-schemes/:id — projects using it revert to the engine
 *  default (FK ON DELETE SET NULL). */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_workflows");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteScheme(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
