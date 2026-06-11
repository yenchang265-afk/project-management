import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCql } from "@/lib/cql";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { createFilter, listFilters } from "@/server/repo/filters";

const CreateFilterSchema = z.object({
  name: z.string().min(1).max(120),
  cql: z.string().min(1).max(2000),
  shared: z.boolean().optional(),
}).strict();

/** GET /api/filters — the caller's saved filters + everyone's shared ones.
 *  `mine` marks rows the caller may delete. */
export const GET = withAuth(async (_req, user) => {
  const filters = await listFilters(user.id);
  return NextResponse.json({
    success: true,
    data: {
      filters: filters.map((f) => ({
        id: f.id, name: f.name, cql: f.cql, shared: f.shared, mine: f.ownerId === user.id,
      })),
    },
  });
});

/** POST /api/filters — save a CQL query. The query must parse: a filter that
 *  can never run is an expectable client mistake → 422. */
export const POST = withAuth(async (req, user) => {
  const body = await parseBody(req, CreateFilterSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Filter needs a name." }, { status: 422 });
  const parsed = parseCql(body.data.cql);
  if (!parsed.ok)
    return NextResponse.json({ success: false, error: `CQL doesn't parse: ${parsed.error}` }, { status: 422 });
  const r = await createFilter(user.id, name, body.data.cql.trim(), body.data.shared ?? false);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
