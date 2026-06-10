import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { addProjectTeam, removeProjectTeam } from "@/server/repo/structure";

const ProjectOpSchema = z.object({
  projectId: z.string().min(1).max(36),
  op: z.enum(["add", "remove"]),
}).strict();

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id: teamId } = await ctx.params;
  const body = await parseBody(req, ProjectOpSchema);
  if (!body.ok) return body.res;
  const r = body.data.op === "add"
    ? await addProjectTeam(teamId, body.data.projectId)
    : await removeProjectTeam(teamId, body.data.projectId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
