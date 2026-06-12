import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createFieldDef, listFieldDefs } from "@/server/repo/fields";

const CreateFieldDefSchema = z.object({
  projectId: z.string().min(1).max(36).nullable().optional(),
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  kind: z.enum(["text", "number", "date", "select"]),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
}).strict();

/** GET /api/fields?projectId=… — global custom-field defs + the project's own. */
export const GET = withAuth(async (req) => {
  const projectId = (new URL(req.url).searchParams.get("projectId") ?? "").trim() || null;
  const fields = await listFieldDefs(projectId);
  return NextResponse.json({ success: true, data: { fields } });
});

/** POST /api/fields — PM-managed definition write (values stay in WI events). */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const body = await parseBody(req, CreateFieldDefSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Field needs a name." }, { status: 422 });
  const r = await createFieldDef(
    body.data.projectId ?? null, body.data.key.trim().toLowerCase(), name,
    body.data.kind, body.data.options ?? null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
