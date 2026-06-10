import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { addTeamMember, removeTeamMember } from "@/server/repo/structure";

const MemberOpSchema = z.object({
  userId: z.string().min(1).max(36),
  op: z.enum(["add", "remove"]),
}).strict();

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id: teamId } = await ctx.params;
  const body = await parseBody(req, MemberOpSchema);
  if (!body.ok) return body.res;
  const r = body.data.op === "add"
    ? await addTeamMember(teamId, body.data.userId)
    : await removeTeamMember(teamId, body.data.userId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
