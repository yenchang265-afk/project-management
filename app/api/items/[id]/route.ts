import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { getItem } from "@/server/repo/items";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_req, _user, ctx) => {
  const { id } = await ctx.params;
  const found = await getItem(id);
  if (!found) return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  return NextResponse.json({ success: true, data: { item: found.item, version: found.version } });
});
