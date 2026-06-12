import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { setItemArchived } from "@/server/repo/items";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({ archived: z.boolean() }).strict();

/** PATCH /api/items/:id/archive — PM-only visibility flag (never an event). */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, Schema);
  if (!body.ok) return body.res;
  const ok = await setItemArchived(id, body.data.archived);
  if (!ok) return NextResponse.json({ success: false, error: "Item not found." }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
