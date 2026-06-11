import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { getItem } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  const found = await getItem(id);
  // out-of-scope items are indistinguishable from missing (no existence leak)
  if (!found || !itemInScope(found.item.project ?? null, await getScope(user)))
    return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  return NextResponse.json({ success: true, data: { item: found.item, version: found.version } });
});
