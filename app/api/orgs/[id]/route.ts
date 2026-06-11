import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody, requirePM } from "@/server/http";
import { deleteOrg, renameOrg } from "@/server/repo/structure";

const RenameSchema = z.object({ name: z.string().min(2).max(128) }).strict();

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, RenameSchema);
  if (!body.ok) return body.res;
  const r = await renameOrg(id, body.data.name.trim());
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});

export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePM(user);
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteOrg(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
