import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { createAnnouncement, getAnnouncements } from "@/server/repo/announcements";
import { getScope } from "@/server/scope";

export const GET = withAuth(async (_req, user) => {
  const scope = await getScope(user);
  const announcements = await getAnnouncements(scope);
  return NextResponse.json({ success: true, data: { announcements } });
});

const CreateSchema = z.object({
  scopeType: z.enum(["company", "org", "team"]),
  scopeId: z.string().min(1).max(36).nullable().optional(),
  title: z.string().min(2).max(160),
  body: z.string().max(2000).nullable().optional(),
}).strict();

export const POST = withAuth(async (req, user) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const body = await parseBody(req, CreateSchema);
  if (!body.ok) return body.res;
  const d = body.data;
  const r = await createAnnouncement(
    d.scopeType, d.scopeId ?? null,
    d.title.trim(), d.body?.trim() || null, user.name);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
