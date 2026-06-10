/* Command layer — the ONLY write path. The client sends intent; this module
   validates (zod shape + engine rules + role guards that used to live in the UI)
   and returns the event to append. Pure: no DB, no Next.js — unit-testable. */
import { z } from "zod";
import {
  GATES, STATES, SUBTRACK_FLOW,
  applyTransition, commentWorkItem, createWorkItem, deleteWorkItem, deriveItem, ev,
  linkWorkItems, reorderWorkItem, transitionWorkItem, unlinkWorkItems, updateWorkItem,
  WI_LINK_TYPES, WI_PHASES_ALL, WI_STATES_ALL, WI_TYPES_ALL,
  type ConditionDef, type GateKey, type Item, type PdlcEvent, type Rejection, type Role,
  type StateKey, type SubtrackState, type TrackKey, type WorkItem,
} from "@/lib/engine";

/* ---------- zod schemas ---------- */
const stateKeys = Object.keys(STATES) as [StateKey, ...StateKey[]];
const wiStates = WI_STATES_ALL as [typeof WI_STATES_ALL[number], ...typeof WI_STATES_ALL];
const wiTypes = WI_TYPES_ALL as [typeof WI_TYPES_ALL[number], ...typeof WI_TYPES_ALL];
const wiPhases = WI_PHASES_ALL as [typeof WI_PHASES_ALL[number], ...typeof WI_PHASES_ALL];
const linkTypes = WI_LINK_TYPES as [typeof WI_LINK_TYPES[number], ...typeof WI_LINK_TYPES];

/* JSON can't carry undefined, so "clear this field" travels as null;
   toPatch() converts null → present-but-undefined, which the engine reads as a clear. */
const WiPatchSchema = z.object({
  title: z.string().max(500).optional(),
  type: z.enum(wiTypes).optional(),
  state: z.enum(wiStates).optional(),
  assignee: z.string().max(128).optional(),
  description: z.string().max(20_000).optional(),
  acceptanceCriteria: z.string().max(20_000).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  storyPoints: z.number().min(0).max(1000).nullable().optional(),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  tags: z.array(z.string().max(40)).max(50).optional(),
  phase: z.enum(wiPhases).nullable().optional(),
  sprint: z.string().max(64).nullable().optional(),
}).strict();

export const CommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transition"), to: z.enum(stateKeys), reason: z.string().max(500).nullable() }).strict(),
  z.object({ kind: z.literal("condition"), op: z.enum(["satisfy", "waive", "reset"]), key: z.string().max(64) }).strict(),
  z.object({ kind: z.literal("signoff"), gate: z.enum(["ready_for_dev", "release"]), clear: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("shiftLeft"), risk: z.string().max(64), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("subtrack"), track: z.enum(["security", "compliance"]), to: z.enum(["pending", "in_review", "changes_requested", "approved"]) }).strict(),
  z.object({ kind: z.literal("flag"), flag: z.enum(["blocked", "on_hold"]), value: z.boolean(), reason: z.string().max(500).nullable() }).strict(),
  z.object({
    kind: z.literal("wiCreate"),
    draft: z.object({
      type: z.enum(wiTypes), title: z.string().max(500), assignee: z.string().max(128),
      state: z.enum(wiStates).optional(), phase: z.enum(wiPhases).optional(), sprint: z.string().max(64).optional(),
    }).strict(),
  }).strict(),
  z.object({ kind: z.literal("wiUpdate"), wiId: z.string().max(32), patch: WiPatchSchema }).strict(),
  z.object({ kind: z.literal("wiDelete"), wiId: z.string().max(32) }).strict(),
  z.object({ kind: z.literal("wiComment"), wiId: z.string().max(32), text: z.string().max(10_000) }).strict(),
  z.object({ kind: z.literal("wiMove"), wiId: z.string().max(32), to: z.enum(wiStates) }).strict(),
  z.object({ kind: z.literal("wiLink"), wiId: z.string().max(32), type: z.enum(linkTypes), target: z.string().max(32) }).strict(),
  z.object({ kind: z.literal("wiUnlink"), wiId: z.string().max(32), type: z.enum(linkTypes), target: z.string().max(32) }).strict(),
  z.object({ kind: z.literal("wiReorder"), wiId: z.string().max(32), toIndex: z.number().int().min(0).max(10_000) }).strict(),
]);

export type Command = z.infer<typeof CommandSchema>;

export const CommandRequestSchema = z.object({
  command: CommandSchema,
  expectedVersion: z.number().int().min(0),
}).strict();

/* ---------- dispatch ---------- */
export type CommandResult =
  | { ok: true; event: PdlcEvent }
  | { ok: false; error: string; rejection?: Rejection };

function fail(error: string, rejection?: Rejection): CommandResult {
  return { ok: false, error, rejection };
}

function findCond(key: string): ConditionDef | null {
  for (const g of Object.values(GATES)) {
    const c = g.conditions.find((x) => x.key === key);
    if (c) return c;
  }
  return null;
}

/** Convert a wire patch (null = clear) into the engine's Partial<WorkItem> convention. */
function toPatch(p: z.infer<typeof WiPatchSchema>): Partial<WorkItem> {
  const out: Partial<WorkItem> = {};
  for (const [k, v] of Object.entries(p)) {
    (out as Record<string, unknown>)[k] = v === null ? undefined : v;
  }
  return out;
}

export function runCommand(item: Item, cmd: Command, actor: string, role: Role): CommandResult {
  const snap = deriveItem(item);

  switch (cmd.kind) {
    case "transition": {
      const r = applyTransition(item, cmd.to, actor, role, cmd.reason);
      return r.ok ? { ok: true, event: r.event } : fail(r.rejection.message, r.rejection);
    }
    case "condition": {
      const c = findCond(cmd.key);
      if (!c) return fail(`Unknown condition "${cmd.key}".`);
      if (role !== c.owner) return fail(`Only ${c.owner} can ${cmd.op} ${cmd.key}.`);
      const type = cmd.op === "satisfy" ? "CONDITION_SATISFY" : cmd.op === "waive" ? "CONDITION_WAIVE" : "CONDITION_RESET";
      return { ok: true, event: ev(item.id, type, actor, role, { condition: cmd.key }) };
    }
    case "signoff": {
      // each role signs (or clears) its own slot — same rule the UI enforced
      return { ok: true, event: ev(item.id, cmd.clear ? "GATE_SIGNOFF_CLEAR" : "GATE_SIGNOFF", actor, role, { gate: cmd.gate as GateKey }) };
    }
    case "shiftLeft": {
      if (role !== "PM") return fail("Only PM can set risk flags.");
      return { ok: true, event: ev(item.id, "SHIFT_LEFT_SET", actor, role, { risk: cmd.risk, value: cmd.value }) };
    }
    case "subtrack": {
      const owner: Role = cmd.track === "security" ? "Dev" : "PM";
      if (role !== owner) return fail(`Only ${owner} can advance the ${cmd.track} review.`);
      const cur = snap.subtracks[cmd.track as TrackKey];
      if (!SUBTRACK_FLOW[cur].includes(cmd.to as SubtrackState))
        return fail(`${cmd.track} review can’t move ${cur} → ${cmd.to}.`);
      return { ok: true, event: ev(item.id, "SUBTRACK", actor, role, { track: cmd.track as TrackKey, to: cmd.to as SubtrackState }) };
    }
    case "flag":
      return { ok: true, event: ev(item.id, "FLAG_SET", actor, role, { flag: cmd.flag, value: cmd.value, reason: cmd.reason }) };
    case "wiCreate": {
      const r = createWorkItem(item, snap, cmd.draft, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiUpdate": {
      const r = updateWorkItem(item, snap, cmd.wiId, toPatch(cmd.patch), actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiDelete": {
      const r = deleteWorkItem(item, snap, cmd.wiId, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiComment": {
      const r = commentWorkItem(item, snap, cmd.wiId, cmd.text, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiMove": {
      const r = transitionWorkItem(item, snap, cmd.wiId, cmd.to, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiLink": {
      const r = linkWorkItems(item, snap, cmd.wiId, cmd.type, cmd.target, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiUnlink": {
      const r = unlinkWorkItems(item, snap, cmd.wiId, cmd.type, cmd.target, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
    case "wiReorder": {
      const r = reorderWorkItem(item, snap, cmd.wiId, cmd.toIndex, actor, role);
      return r.ok ? { ok: true, event: r.event } : fail(r.error);
    }
  }
}
