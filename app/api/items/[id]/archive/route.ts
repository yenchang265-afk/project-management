import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { setItemArchived, getItem } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({ archived: z.boolean() }).strict();

/** PATCH /api/items/:id/archive — PM-only visibility flag (never an event). */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const { id } = await ctx.params;
  const [found, scope] = await Promise.all([getItem(id), getScope(user)]);
  if (!found || !itemInScope(found.item.project ?? null, scope))
    return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  const body = await parseBody(req, Schema);
  if (!body.ok) return body.res;
  const ok = await setItemArchived(id, body.data.archived);
  if (!ok) return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  return NextResponse.json({ success: true, data: {} });
});
