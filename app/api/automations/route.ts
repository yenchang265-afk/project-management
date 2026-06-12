import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCql } from "@/lib/cql";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { WiPatchSchema } from "@/server/commands";
import { createRule, listRules, listRuns } from "@/server/repo/automations";

const ActionSchema = z.union([
  z.object({ kind: z.literal("wiMove"), to: z.string().min(1).max(32) }).strict(),
  z.object({ kind: z.literal("wiComment"), text: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("itemComment"), text: z.string().min(1).max(2000) }).strict(),
  z.object({
    kind: z.literal("wiUpdate"),
    // the SAME patch schema the command endpoint enforces — invalid rules can't be saved
    patch: WiPatchSchema.refine((p) => Object.keys(p).length > 0, "Empty patch."),
  }).strict(),
]);

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(120),
  triggerKind: z.string().min(1).max(32),
  cql: z.string().max(2000).nullable().optional(),
  actions: z.array(ActionSchema).min(1).max(10),
}).strict();

/** GET /api/automations — rules + recent runs. PM only. */
export const GET = withAuth(async (_req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const [rules, runs] = await Promise.all([listRules(), listRuns()]);
  return NextResponse.json({ success: true, data: { rules, runs } });
});

/** POST /api/automations — PM only; the CQL condition must parse. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const body = await parseBody(req, CreateRuleSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Rule needs a name." }, { status: 422 });
  const cql = body.data.cql?.trim() || null;
  if (cql) {
    const parsed = parseCql(cql);
    if (!parsed.ok)
      return NextResponse.json({ success: false, error: `Condition doesn't parse: ${parsed.error}` }, { status: 422 });
  }
  const r = await createRule(name, body.data.triggerKind.trim().toUpperCase(), cql, body.data.actions);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: { id: r.id } });
});
