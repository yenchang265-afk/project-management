import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createGoal, listGoals } from "@/server/repo/goals";
import { getScope } from "@/server/scope";

const CreateGoalSchema = z.object({
  title: z.string().min(1).max(160),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();

/** GET /api/goals — goals with member item ids scoped to the caller's projects.
 *  Progress is derived client-side from the items the caller already holds. */
export const GET = withAuth(async (_req, user) => {
  const scope = await getScope(user);
  const goals = await listGoals(scope.all ? undefined : scope.projectIds);
  return NextResponse.json({ success: true, data: { goals } });
});

/** POST /api/goals — PM only. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const body = await parseBody(req, CreateGoalSchema);
  if (!body.ok) return body.res;
  const title = body.data.title.trim();
  if (!title) return NextResponse.json({ success: false, error: "Goal needs a title." }, { status: 422 });
  const r = await createGoal(title, body.data.targetDate ?? null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
