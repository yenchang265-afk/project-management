import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createTeam } from "@/server/repo/structure";

const CreateTeamSchema = z.object({ name: z.string().min(2).max(128) }).strict();

export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_teams");
  if (guard) return guard;
  const body = await parseBody(req, CreateTeamSchema);
  if (!body.ok) return body.res;
  const r = await createTeam(body.data.name.trim());
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
