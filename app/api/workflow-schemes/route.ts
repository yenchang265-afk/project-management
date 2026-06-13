import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createScheme, listSchemes } from "@/server/repo/workflows";
import { TransitionWireSchema } from "@/server/workflow-schema";

const CreateSchemeSchema = z.object({
  name: z.string().min(2).max(128),
  transitions: z.array(TransitionWireSchema).min(1).max(200),
}).strict();

/** GET /api/workflow-schemes — all schemes (with their transition tables). */
export const GET = withAuth(async () => {
  const schemes = await listSchemes();
  return NextResponse.json({ success: true, data: { schemes } });
});

/** POST /api/workflow-schemes — create a scheme (PM-only, validated). */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_workflows");
  if (guard) return guard;
  const body = await parseBody(req, CreateSchemeSchema);
  if (!body.ok) return body.res;
  const r = await createScheme(body.data.name.trim(), body.data.transitions);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
