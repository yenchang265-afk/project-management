import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { assignItemProject } from "@/server/repo/structure";

const AssignSchema = z.object({ projectId: z.string().min(1).max(36).nullable() }).strict();

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id: itemId } = await ctx.params;
  const body = await parseBody(req, AssignSchema);
  if (!body.ok) return body.res;
  const r = await assignItemProject(itemId, body.data.projectId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
