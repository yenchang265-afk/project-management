import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { assignScheme } from "@/server/repo/workflows";

const AssignSchema = z.object({ schemeId: z.string().min(1).max(36).nullable() }).strict();

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/projects/:id/workflow-scheme — point a project at a scheme, or
 *  null to revert to the engine default. PM only. */
export const PUT = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_workflows");
  if (guard) return guard;
  const { id: projectId } = await ctx.params;
  const body = await parseBody(req, AssignSchema);
  if (!body.ok) return body.res;
  const r = await assignScheme(projectId, body.data.schemeId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
