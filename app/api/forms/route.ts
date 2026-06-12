import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createForm, listForms } from "@/server/repo/forms";

const CreateFormSchema = z.object({
  itemId: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
}).strict();

/** GET /api/forms — PM only (the list carries the public submit tokens). */
export const GET = withAuth(async (_req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const forms = await listForms();
  return NextResponse.json({ success: true, data: { forms } });
});

/** POST /api/forms — PM only; mints the public token. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const body = await parseBody(req, CreateFormSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Form needs a name." }, { status: 422 });
  const r = await createForm(body.data.itemId, name);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
