import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createProject } from "@/server/repo/structure";

const CreateProjectSchema = z.object({
  key: z.string().min(2).max(8).regex(/^[A-Za-z][A-Za-z0-9]*$/, "Key must be alphanumeric"),
  name: z.string().min(2).max(128),
  description: z.string().max(500).nullable().optional(),
}).strict();

export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const body = await parseBody(req, CreateProjectSchema);
  if (!body.ok) return body.res;
  const r = await createProject(body.data.key, body.data.name.trim(), body.data.description ?? null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
