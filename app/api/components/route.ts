import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createComponent, listComponents } from "@/server/repo/registries";

const CreateComponentSchema = z.object({
  projectId: z.string().min(1).max(36),
  name: z.string().min(1).max(80),
}).strict();

/** GET /api/components?projectId=… — a project's component registry. */
export const GET = withAuth(async (req) => {
  const projectId = (new URL(req.url).searchParams.get("projectId") ?? "").trim();
  if (!projectId)
    return NextResponse.json({ success: false, error: "projectId is required." }, { status: 400 });
  const components = await listComponents(projectId);
  return NextResponse.json({ success: true, data: { components } });
});

/** POST /api/components — PM-managed registry write. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const body = await parseBody(req, CreateComponentSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Component needs a name." }, { status: 422 });
  const r = await createComponent(body.data.projectId, name);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
