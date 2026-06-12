import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { deleteRule, setRuleEnabled } from "@/server/repo/automations";

type Ctx = { params: Promise<{ id: string }> };

const PatchSchema = z.object({ enabled: z.boolean() }).strict();

/** PATCH /api/automations/:id — enable/disable. PM only. */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, PatchSchema);
  if (!body.ok) return body.res;
  const r = await setRuleEnabled(id, body.data.enabled);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});

/** DELETE /api/automations/:id — PM only. */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteRule(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
