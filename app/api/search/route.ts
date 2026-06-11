import { NextResponse } from "next/server";
import { matchItems } from "@/lib/search";
import { withAuth } from "@/server/auth";
import { getAllItems } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";

/** GET /api/search?q=… — server-side search over the caller's SCOPED items
 *  (same visibility as GET /api/items). Short queries return empty, not 400. */
export const GET = withAuth(async (req, user) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2)
    return NextResponse.json({ success: true, data: { results: [] } });

  const [allItems, scope] = await Promise.all([getAllItems(), getScope(user)]);
  const rows = allItems.filter((r) => itemInScope(r.item.project ?? null, scope));
  return NextResponse.json({ success: true, data: { results: matchItems(rows, q) } });
});
