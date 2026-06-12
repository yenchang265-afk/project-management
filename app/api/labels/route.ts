import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createLabel, listLabels } from "@/server/repo/registries";

const CreateLabelSchema = z.object({ name: z.string().min(1).max(40) }).strict();

/** GET /api/labels — the global label registry (feeds tag autocomplete). */
export const GET = withAuth(async () => {
  const labels = await listLabels();
  return NextResponse.json({ success: true, data: { labels } });
});

/** POST /api/labels — PM-managed registry write. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const body = await parseBody(req, CreateLabelSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Label needs a name." }, { status: 422 });
  const r = await createLabel(name);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
