/* Command layer — the ONLY write path. The client sends intent; this module
   validates (zod shape + engine rules + role guards that used to live in the UI)
   and returns the event to append. Pure: no DB, no Next.js — unit-testable. */
import { z } from "zod";
import {
  GATES, STATES, SUBTRACK_FLOW,
  applyTransition, commentWorkItem, createWorkItem, deleteWorkItem, deriveItem, ev,
  linkWorkItems, logWork, reorderWorkItem, transitionWorkItem, unlinkWorkItems, updateWorkItem,
  ITEM_LINK_KINDS, ITEM_LINK_LABELS, WI_LINK_TYPES, WI_PHASES_ALL, WI_STATES_ALL, WI_TYPES_ALL,
  type ConditionDef, type GateKey, type Item, type PdlcEvent, type Rejection, type Role,
  type StateKey, type SubtrackState, type TrackKey, type WorkItem,
} from "@/lib/engine";

/* ---------- zod schemas ---------- */
const stateKeys = Object.keys(STATES) as [StateKey, ...StateKey[]];
const wiStates = WI_STATES_ALL as [typeof WI_STATES_ALL[number], ...typeof WI_STATES_ALL];
const wiTypes = WI_TYPES_ALL as [typeof WI_TYPES_ALL[number], ...typeof WI_TYPES_ALL];
const wiPhases = WI_PHASES_ALL as [typeof WI_PHASES_ALL[number], ...typeof WI_PHASES_ALL];
const linkTypes = WI_LINK_TYPES as [typeof WI_LINK_TYPES[number], ...typeof WI_LINK_TYPES];
const itemLinkKinds = ITEM_LINK_KINDS as [typeof ITEM_LINK_KINDS[number], ...typeof ITEM_LINK_KINDS];

/* JSON can't carry undefined, so "clear this field" travels as null;
   toPatch() converts null → present-but-undefined, which the engine reads as a clear. */
export const WiPatchSchema = z.object({
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
  parentWiId: z.string().max(32).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.").nullable().optional(),
  component: z.string().max(80).nullable().optional(),
  originalEstimate: z.number().min(0).max(100_000).nullable().optional(),
  remainingEstimate: z.number().min(0).max(100_000).nullable().optional(),
  // per-key delta: null deletes that key (top-level toPatch() null-handling must NOT apply)
  customFields: z.record(z.string().min(1).max(64), z.union([z.string().max(2000), z.number(), z.null()]))
    .refine((m) => Object.keys(m).length <= 20, "At most 20 custom fields per change.")
    .optional(),
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
      parentWiId: z.string().max(32).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.").optional(),
      component: z.string().max(80).optional(),
      tags: z.array(z.string().max(40)).max(50).optional(),
    }).strict(),
  }).strict(),
  z.object({ kind: z.literal("wiUpdate"), wiId: z.string().max(32), patch: WiPatchSchema }).strict(),
  z.object({ kind: z.literal("wiDelete"), wiId: z.string().max(32) }).strict(),
  z.object({ kind: z.literal("wiComment"), wiId: z.string().max(32), text: z.string().max(10_000) }).strict(),
  z.object({ kind: z.literal("wiWorklog"), wiId: z.string().max(32), hours: z.number().gt(0).max(10_000), note: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal("wiMove"), wiId: z.string().max(32), to: z.enum(wiStates) }).strict(),
  z.object({ kind: z.literal("wiLink"), wiId: z.string().max(32), type: z.enum(linkTypes), target: z.string().max(32) }).strict(),
  z.object({ kind: z.literal("wiUnlink"), wiId: z.string().max(32), type: z.enum(linkTypes), target: z.string().max(32) }).strict(),
  z.object({ kind: z.literal("wiReorder"), wiId: z.string().max(32), toIndex: z.number().int().min(0).max(10_000) }).strict(),
  z.object({ kind: z.literal("item_comment"), text: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("watch"), on: z.boolean() }).strict(),
  z.object({ kind: z.literal("item_link"), to: z.string().min(1).max(32), linkKind: z.enum(itemLinkKinds) }).strict(),
  z.object({ kind: z.literal("item_unlink"), to: z.string().min(1).max(32), linkKind: z.enum(itemLinkKinds) }).strict(),
]);

export type Command = z.infer<typeof CommandSchema>;

export const CommandRequestSchema = z.object({
  command: CommandSchema,
  expectedVersion: z.number().int().min(0),
}).strict();

/* Bulk wire shape (POST /api/items/bulk): up to 50 single-route ops in one
   request. Each op reuses the SAME CommandSchema — never a parallel copy. */
export const BulkOpSchema = z.object({
  itemId: z.string().min(1).max(32),
  expectedVersion: z.number().int().min(0),
  command: CommandSchema,
}).strict();

export const BulkRequestSchema = z.object({
  ops: z.array(BulkOpSchema).min(1).max(50),
}).strict();

export type BulkOp = z.infer<typeof BulkOpSchema>;

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
    case "wiWorklog": {
      const r = logWork(item, snap, cmd.wiId, cmd.hours, cmd.note, actor, role);
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
    case "item_comment": {
      // both roles may comment; actor/role come from the session (never the body)
      const body = cmd.text.trim();
      if (!body) return fail("Comment can’t be empty.");
      return { ok: true, event: ev(item.id, "ITEM_COMMENT", actor, role, { text: body }) };
    }
    case "watch":
      // both roles may watch; the fold keys watchers by the SESSION actor's name
      return { ok: true, event: ev(item.id, "WATCH_SET", actor, role, { on: cmd.on }) };
    case "item_link": {
      // informational v1 — both roles may link; never gates transitions
      if (cmd.to === item.id) return fail("An item can’t link to itself.");
      if (snap.links.some((l) => l.to === cmd.to && l.linkKind === cmd.linkKind))
        return fail(`${item.id} already ${ITEM_LINK_LABELS[cmd.linkKind].out} ${cmd.to}.`);
      return { ok: true, event: ev(item.id, "ITEM_LINK", actor, role, { to: cmd.to, linkKind: cmd.linkKind }) };
    }
    case "item_unlink": {
      if (!snap.links.some((l) => l.to === cmd.to && l.linkKind === cmd.linkKind))
        return fail(`No "${cmd.linkKind}" link from ${item.id} to ${cmd.to}.`);
      return { ok: true, event: ev(item.id, "ITEM_UNLINK", actor, role, { to: cmd.to, linkKind: cmd.linkKind }) };
    }
  }
}
