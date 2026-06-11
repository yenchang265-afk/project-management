import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { requirePerm } from "@/server/permissions";
import { deleteAnnouncement } from "@/server/repo/announcements";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_announcements");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteAnnouncement(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 404 });
  return NextResponse.json({ success: true, data: {} });
});
