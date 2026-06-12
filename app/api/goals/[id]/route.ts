import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { deleteGoal, goalItemOp, setGoalStatus } from "@/server/repo/goals";

type Ctx = { params: Promise<{ id: string }> };

const PatchGoalSchema = z.union([
  z.object({ status: z.enum(["active", "done", "cancelled"]) }).strict(),
  z.object({ op: z.enum(["add", "remove"]), itemId: z.string().min(1).max(32) }).strict(),
]);

/** PATCH /api/goals/:id — PM only: flip status, or add/remove a member item. */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, PatchGoalSchema);
  if (!body.ok) return body.res;
  const r = "status" in body.data
    ? await setGoalStatus(id, body.data.status)
    : await goalItemOp(id, body.data.itemId, body.data.op);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});

/** DELETE /api/goals/:id — PM only. */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteGoal(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
