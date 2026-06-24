import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createVersion, listVersions } from "@/server/repo/versions";
import { getScope } from "@/server/scope";

const CreateVersionSchema = z.object({
  projectId: z.string().min(1).max(36),
  name: z.string().min(1).max(80),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();

/** GET /api/versions?projectId=… — a project's versions with member counts. */
export const GET = withAuth(async (req, user) => {
  const projectId = (new URL(req.url).searchParams.get("projectId") ?? "").trim();
  if (!projectId)
    return NextResponse.json({ success: false, error: "projectId is required." }, { status: 400 });
  const scope = await getScope(user);
  if (!scope.all && !scope.projectIds.has(projectId))
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  const versions = await listVersions(projectId);
  return NextResponse.json({ success: true, data: { versions } });
});

/** POST /api/versions — PM only. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const body = await parseBody(req, CreateVersionSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Version needs a name." }, { status: 422 });
  const r = await createVersion(body.data.projectId, name, body.data.releaseDate ?? null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
