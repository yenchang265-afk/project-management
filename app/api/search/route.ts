import { NextResponse } from "next/server";
import { matchItems } from "@/lib/search";
import { itemsToCqlRows, parseCql, runCql } from "@/lib/cql";
import { withAuth } from "@/server/auth";
import { getAllItems } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";

const CQL_ROW_CAP = 200;

/** GET /api/search?q=… — server-side substring search over the caller's SCOPED
 *  items (same visibility as GET /api/items). Short queries return empty, not 400.
 *
 *  GET /api/search?cql=… — CQL over the scoped items' DERIVED work items.
 *  Parse errors are expectable client mistakes → 422 {success:false,error}.
 *  Results are capped at 200 rows; `total` carries the uncapped match count. */
export const GET = withAuth(async (req, user) => {
  const params = new URL(req.url).searchParams;
  const cql = (params.get("cql") ?? "").trim();

  if (cql) {
    const parsed = parseCql(cql);
    if (!parsed.ok)
      return NextResponse.json({ success: false, error: parsed.error }, { status: 422 });
    const [allItems, scope] = await Promise.all([getAllItems(), getScope(user)]);
    const items = allItems.filter((r) => itemInScope(r.item.project ?? null, scope)).map((r) => r.item);
    const matched = runCql(parsed.query, itemsToCqlRows(items));
    return NextResponse.json({
      success: true,
      data: { rows: matched.slice(0, CQL_ROW_CAP), total: matched.length },
    });
  }

  const q = (params.get("q") ?? "").trim();
  if (q.length < 2)
    return NextResponse.json({ success: true, data: { results: [] } });

  const [allItems, scope] = await Promise.all([getAllItems(), getScope(user)]);
  const rows = allItems.filter((r) => itemInScope(r.item.project ?? null, scope));
  return NextResponse.json({ success: true, data: { results: matchItems(rows, q) } });
});
