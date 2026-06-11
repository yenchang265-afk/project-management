import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { CreateSprintSchema } from "@/server/sprint-schemas";
import { createSprint, isTeamMember, listSprints } from "@/server/repo/sprints";

type Ctx = { params: Promise<{ id: string }> };

/** List a team's registry sprints — readable by any member of the team or a PM. */
export const GET = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id: teamId } = await ctx.params;
  if (user.role !== "PM" && !(await isTeamMember(teamId, user.id)))
    return NextResponse.json({ success: false, error: "Only team members can view this team's sprints." }, { status: 403 });
  const sprints = await listSprints(teamId);
  return NextResponse.json({ success: true, data: { sprints } });
});

export const POST = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id: teamId } = await ctx.params;
  const body = await parseBody(req, CreateSprintSchema);
  if (!body.ok) return body.res;
  const r = await createSprint(teamId, body.data.name.trim(), body.data.start ?? null, body.data.end ?? null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
