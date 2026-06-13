import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createComponent } from "@/server/repo/registries";
import { createFieldDef } from "@/server/repo/fields";
import { createProject } from "@/server/repo/structure";
import { PROJECT_TEMPLATES, templateById } from "@/server/templates";

const CreateProjectSchema = z.object({
  key: z.string().min(2).max(8).regex(/^[A-Za-z][A-Za-z0-9]*$/, "Key must be alphanumeric"),
  name: z.string().min(2).max(128),
  description: z.string().max(500).nullable().optional(),
  templateId: z.string().max(40).optional(), // default: cadence-pdlc (seeds nothing)
}).strict();

/** GET /api/projects — the available project templates (creation modal picker). */
export const GET = withAuth(async () => {
  return NextResponse.json({
    success: true,
    data: { templates: PROJECT_TEMPLATES.map((t) => ({ id: t.id, name: t.name })) },
  });
});

export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const body = await parseBody(req, CreateProjectSchema);
  if (!body.ok) return body.res;
  const template = templateById(body.data.templateId ?? "cadence-pdlc");
  if (!template)
    return NextResponse.json({ success: false, error: "Unknown template." }, { status: 422 });
  const r = await createProject(body.data.key, body.data.name.trim(), body.data.description ?? null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  // seed the template's registries — duplicates can't happen on a fresh project
  for (const c of template.components) await createComponent(r.id, c);
  for (const f of template.fieldDefs) await createFieldDef(r.id, f.key, f.name, f.kind, f.options);
  return NextResponse.json({ success: true, data: { id: r.id } });
});
