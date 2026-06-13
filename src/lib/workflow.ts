/* Workflow schemes (G-13) — pure validation + resolution.

   A "scheme" is just a TransitionDef[] that a project can use in place of the
   engine's built-in TRANSITIONS. STATES and GATES stay engine-defined (the
   spine and its gate conditions are core invariants); a scheme only re-wires
   the EDGES between states: which moves exist, their roles, kind, reason rule,
   and which forward edges carry a gate.

   validateWorkflow is the single guard an editor (or an API write) must pass
   before a scheme is stored, so a malformed scheme can never reach the engine. */
import { GATES, STATES, type StateKey, type TransitionDef, type TransitionKind } from "./engine";

export type WorkflowValidation = { ok: true } | { ok: false; errors: string[] };

const VALID_KINDS: TransitionKind[] = ["forward", "rework", "terminal", "recovery", "hotfix"];
const VALID_ROLES = ["PM", "Dev"];

/** The 12 on-spine states that every scheme must keep reachable from backlog. */
const SPINE_STATES: StateKey[] = (Object.values(STATES) as { key: StateKey; spine?: number }[])
  .filter((s) => s.spine != null)
  .map((s) => s.key);

/**
 * Validate a candidate transition table against the engine's structural
 * invariants. Returns every problem found (not just the first) so an editor
 * can surface them all at once.
 */
export function validateWorkflow(transitions: TransitionDef[]): WorkflowValidation {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const t of transitions) {
    const edge = `${t.from}→${t.to}`;
    if (!STATES[t.from]) errors.push(`Unknown from-state "${t.from}" on ${edge}.`);
    if (!STATES[t.to]) errors.push(`Unknown to-state "${t.to}" on ${edge}.`);
    if (!VALID_KINDS.includes(t.kind)) errors.push(`Invalid kind "${t.kind}" on ${edge}.`);
    if (!Array.isArray(t.roles) || t.roles.length === 0)
      errors.push(`Transition ${edge} must list at least one role.`);
    else
      for (const r of t.roles)
        if (!VALID_ROLES.includes(r)) errors.push(`Invalid role "${r}" on ${edge}.`);
    if (t.gate) {
      if (!GATES[t.gate]) errors.push(`Unknown gate "${t.gate}" on ${edge}.`);
      if (t.kind !== "forward") errors.push(`Gate "${t.gate}" must sit on a forward transition, not "${t.kind}" (${edge}).`);
    }
    if (t.needsReason && t.needsReason !== "reject" && t.needsReason !== "free")
      errors.push(`Invalid needsReason "${t.needsReason}" on ${edge}.`);
    if (seen.has(edge)) errors.push(`Duplicate transition ${edge}.`);
    seen.add(edge);
  }

  // Spine reachability: BFS from backlog over every edge whose endpoints exist.
  const adj = new Map<string, string[]>();
  for (const t of transitions) {
    if (!STATES[t.from] || !STATES[t.to]) continue;
    (adj.get(t.from) ?? adj.set(t.from, []).get(t.from)!).push(t.to);
  }
  const reached = new Set<string>(["backlog"]);
  const queue = ["backlog"];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? [])
      if (!reached.has(next)) { reached.add(next); queue.push(next); }
  }
  const unreachable = SPINE_STATES.filter((s) => !reached.has(s));
  if (unreachable.length)
    errors.push(`Spine states unreachable from backlog: ${unreachable.join(", ")}.`);

  return errors.length ? { ok: false, errors } : { ok: true };
}
