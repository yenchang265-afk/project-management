import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { createOrg } from "@/server/repo/structure";

const CreateOrgSchema = z.object({ name: z.string().min(2).max(128) }).strict();

export const POST = withAuth(async (req, user) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const body = await parseBody(req, CreateOrgSchema);
  if (!body.ok) return body.res;
  const r = await createOrg(body.data.name.trim());
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
