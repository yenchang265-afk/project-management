import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { assignItemVersion } from "@/server/repo/versions";

type Ctx = { params: Promise<{ id: string }> };

const AssignSchema = z.object({ versionId: z.string().min(1).max(64).nullable() }).strict();

/** PATCH /api/items/:id/version — assign/clear fix version (PM, metadata
 *  column update like item→project; never an event). */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "assign_item_project");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, AssignSchema);
  if (!body.ok) return body.res;
  const r = await assignItemVersion(id, body.data.versionId);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
