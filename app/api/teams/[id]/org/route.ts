import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { setTeamOrg } from "@/server/repo/structure";

// orgId null clears the team's org (moves it to "Unassigned").
const SetOrgSchema = z.object({ orgId: z.string().min(1).max(36).nullable() }).strict();

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id: teamId } = await ctx.params;
  const body = await parseBody(req, SetOrgSchema);
  if (!body.ok) return body.res;
  const r = await setTeamOrg(teamId, body.data.orgId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
