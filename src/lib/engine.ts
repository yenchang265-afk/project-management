/* =========================================================================
   PDLC ENGINE — pure, event-sourced state machine.
   No React, no DOM. Everything here is data + pure functions.
   The single source of truth is the append-only event log; current state,
   gate conditions, flags, sign-offs, sub-tracks and analytics are all
   DERIVED by folding events.
   ========================================================================= */

/* ---------- Types ---------- */
export type Role = "PM" | "Dev";
export type Lane = "discovery" | "build" | "verify" | "release" | "closed" | "off";
export type StateKey =
  | "backlog" | "in_discovery" | "defined" | "technical_design"
  | "in_development" | "in_code_review" | "in_qa" | "staging_uat"
  | "deploying" | "released" | "monitoring" | "done"
  | "rejected" | "deferred" | "rolled_back";
export type TransitionKind = "forward" | "rework" | "terminal" | "recovery" | "hotfix";
export type GateKey = "ready_for_dev" | "release";
export type ConditionState = "required" | "satisfied" | "waived" | "not_applicable";
export type TrackKey = "security" | "compliance";
export type SubtrackState = "pending" | "in_review" | "changes_requested" | "approved";
export type FlagKey = "blocked" | "on_hold";
export type WiType = "epic" | "feature" | "story" | "task" | "bug";
export type WiState = "todo" | "in_progress" | "in_review" | "blocked" | "done";
export type EventType =
  | "CREATE" | "TRANSITION" | "CONDITION_SATISFY" | "CONDITION_WAIVE"
  | "CONDITION_RESET" | "SHIFT_LEFT_SET" | "GATE_SIGNOFF" | "GATE_SIGNOFF_CLEAR"
  | "SUBTRACK" | "FLAG_SET" | "SPAWN_CHILD";

export interface StateDef {
  key: StateKey;
  label: string;
  lane: Lane;
  spine?: number;
  terminal?: boolean;
  recovery?: boolean;
}

export interface TransitionDef {
  from: StateKey;
  to: StateKey;
  roles: Role[];
  kind: TransitionKind;
  label: string;
  gate?: GateKey;
  needsReason?: "reject" | "free";
}

export interface ConditionDef {
  key: string;
  label: string;
  owner: Role;
  base: "required" | "not_applicable";
  conditional?: boolean;
  track?: TrackKey;
}

export interface GateDef {
  key: GateKey;
  label: string;
  conditions: ConditionDef[];
}

export interface PdlcEvent {
  id: string;
  item: string;
  type: EventType;
  actor: string;
  role: Role;
  ts: number;
  from?: StateKey;
  to?: StateKey | SubtrackState;
  kind?: TransitionKind;
  reason?: string | null;
  condition?: string;
  gate?: GateKey;
  track?: TrackKey;
  flag?: FlagKey;
  value?: boolean;
  risk?: string;
  child?: string;
}

export interface WorkItem {
  id: string;
  type: WiType;
  title: string;
  state: WiState;
  assignee: string;
}

export interface Stakeholder {
  role: string;
  name: string;
  derived?: boolean;
}

export interface Item {
  id: string;
  title: string;
  area: string;
  priority: "High" | "Medium" | "Low";
  parent: string | null;
  type: WiType;
  stakeholders: Stakeholder[];
  workItems: WorkItem[];
  plan?: Partial<Record<StateKey, number>>;
  events: PdlcEvent[];
}

export interface Snapshot {
  state: StateKey;
  conditions: Record<string, ConditionState>;
  flags: Record<FlagKey, { reason: string | null } | null>;
  signoffs: Record<string, { PM: string | null; Dev: string | null }>;
  subtracks: Record<TrackKey, SubtrackState>;
  children: string[];
  activeRisks: Set<string>;
  events: PdlcEvent[];
}

export interface GateStatus {
  gate: GateDef;
  conds: (ConditionDef & { state: ConditionState })[];
  blocking: (ConditionDef & { state: ConditionState })[];
  signoff: { PM: string | null; Dev: string | null };
  signoffComplete: boolean;
  open: boolean;
}

export interface Rejection {
  type: "ILLEGAL_TRANSITION" | "ROLE_GUARD" | "GATE_CONDITIONS_UNSATISFIED" | "GATE_SIGNOFF_MISSING" | "REASON_REQUIRED";
  message: string;
  detail: Record<string, unknown> & { missing?: Role[]; conditions?: string[] };
}

export type TransitionResult = { ok: true; event: PdlcEvent } | { ok: false; rejection: Rejection };

/* ---------- Roles ---------- */
export const ROLES: Record<string, Role> = { PM: "PM", DEV: "Dev" };

/* ---------- States ----------
   type: spine | gate-pending | terminal | recovery
   lane: discovery | build | verify | release | closed | off
   The "gate" is modeled as a property on transitions, NOT bespoke states. */
export const STATES: Record<StateKey, StateDef> = {
  backlog:          { key: "backlog",          label: "Backlog",          lane: "discovery", spine: 0 },
  in_discovery:     { key: "in_discovery",     label: "In discovery",     lane: "discovery", spine: 1 },
  defined:          { key: "defined",          label: "Defined",          lane: "discovery", spine: 2 },
  technical_design: { key: "technical_design", label: "Technical design", lane: "discovery", spine: 3 },
  in_development:   { key: "in_development",   label: "In development",   lane: "build",     spine: 4 },
  in_code_review:   { key: "in_code_review",   label: "In code review",   lane: "build",     spine: 5 },
  in_qa:            { key: "in_qa",            label: "In QA",            lane: "verify",    spine: 6 },
  staging_uat:      { key: "staging_uat",      label: "Staging / UAT",    lane: "verify",    spine: 7 },
  deploying:        { key: "deploying",        label: "Deploying",        lane: "release",   spine: 8 },
  released:         { key: "released",         label: "Released",         lane: "release",   spine: 9 },
  monitoring:       { key: "monitoring",       label: "Monitoring",       lane: "release",   spine: 10 },
  done:             { key: "done",             label: "Done",             lane: "closed",    spine: 11 },
  // off-spine
  rejected:         { key: "rejected",         label: "Rejected",         lane: "off", terminal: true },
  deferred:         { key: "deferred",         label: "Deferred",         lane: "off", terminal: true },
  rolled_back:      { key: "rolled_back",      label: "Rolled back",      lane: "off", recovery: true },
};

// The two AND-gates sit ON these forward transitions.
export const GATE_BEFORE: Partial<Record<StateKey, GateKey>> = {
  in_development: "ready_for_dev",
  deploying: "release",
};

/* ---------- Transition table (declarative — the ONLY place rules live) ---------- */
export const TRANSITIONS: TransitionDef[] = [
  // ---- happy-path spine ----
  { from: "backlog",          to: "in_discovery",     roles: ["PM"],        kind: "forward", label: "Start discovery" },
  { from: "in_discovery",     to: "defined",          roles: ["PM"],        kind: "forward", label: "Mark defined" },
  { from: "defined",          to: "technical_design", roles: ["Dev"],       kind: "forward", label: "Pick up tech design" },
  { from: "technical_design", to: "in_development",   roles: ["PM", "Dev"], kind: "forward", gate: "ready_for_dev", label: "Open Ready-for-dev gate" },
  { from: "in_development",   to: "in_code_review",   roles: ["Dev"],       kind: "forward", label: "Submit for review" },
  { from: "in_code_review",   to: "in_qa",            roles: ["Dev"],       kind: "forward", label: "Approve review → QA" },
  { from: "in_qa",            to: "staging_uat",      roles: ["Dev"],       kind: "forward", label: "Promote to Staging/UAT" },
  { from: "staging_uat",      to: "deploying",        roles: ["PM", "Dev"], kind: "forward", gate: "release", label: "Open Release gate" },
  { from: "deploying",        to: "released",         roles: ["Dev"],       kind: "forward", label: "Confirm release" },
  { from: "released",         to: "monitoring",       roles: ["Dev"],       kind: "forward", label: "Begin monitoring" },
  { from: "monitoring",       to: "done",             roles: ["PM"],        kind: "forward", label: "Close out → Done" },

  // ---- rework loops (backward) ----
  { from: "defined",        to: "in_discovery",   roles: ["PM"],  kind: "rework", label: "Reopen discovery" },
  { from: "in_code_review", to: "in_development", roles: ["Dev"], kind: "rework", label: "Request changes" },
  { from: "in_qa",          to: "in_development", roles: ["Dev"], kind: "rework", label: "QA failed → dev" },
  { from: "staging_uat",    to: "in_development", roles: ["PM"],  kind: "rework", label: "Reject PM acceptance" },

  // ---- terminals (early states only) ----
  ...(["backlog", "in_discovery", "defined", "technical_design"] as StateKey[]).flatMap(
    (s): TransitionDef[] => [
      { from: s, to: "rejected", roles: ["PM"], kind: "terminal", label: "Reject", needsReason: "reject" },
      { from: s, to: "deferred", roles: ["PM"], kind: "terminal", label: "Defer",  needsReason: "free" },
    ]
  ),

  // ---- post-release recovery ----
  { from: "released",    to: "rolled_back",    roles: ["Dev"], kind: "recovery", label: "Roll back", needsReason: "free" },
  { from: "monitoring",  to: "rolled_back",    roles: ["Dev"], kind: "recovery", label: "Roll back", needsReason: "free" },
  { from: "rolled_back", to: "in_development", roles: ["Dev"], kind: "hotfix",   label: "Hotfix → dev" },
  { from: "monitoring",  to: "in_development", roles: ["Dev"], kind: "hotfix",   label: "Hotfix (expedite)" },
];

/* ---------- Conditions & gates ----------
   Each condition: { key, label, owner, base } where base is the DEFAULT state:
     required        — must be satisfied for the gate to open
     not_applicable  — conditional; the shift-left checklist can flip it on
   Live states a condition can hold: required | satisfied | waived | not_applicable */
export const GATES: Record<GateKey, GateDef> = {
  ready_for_dev: {
    key: "ready_for_dev",
    label: "Ready for dev",
    conditions: [
      { key: "spec_approved",   label: "Spec approved",   owner: "PM",  base: "required" },
      { key: "design_reviewed", label: "Design reviewed", owner: "Dev", base: "required" },
      { key: "estimated",       label: "Estimated",       owner: "Dev", base: "required" },
      { key: "threat_model",    label: "Threat model",    owner: "Dev", base: "not_applicable", conditional: true },
    ],
  },
  release: {
    key: "release",
    label: "Release",
    conditions: [
      { key: "qa_passed",                label: "QA passed",           owner: "Dev", base: "required" },
      { key: "pm_acceptance",            label: "PM acceptance",       owner: "PM",  base: "required" },
      { key: "docs_runbook_ready",       label: "Docs & runbook",      owner: "Dev", base: "required" },
      { key: "security_review_approved", label: "Security review",     owner: "Dev", base: "not_applicable", conditional: true, track: "security" },
      { key: "compliance_signoff",       label: "Compliance sign-off", owner: "PM",  base: "not_applicable", conditional: true, track: "compliance" },
    ],
  },
};

/* ---------- Shift-left checklist ----------
   Ticking a risk flips its mapped conditional conditions not_applicable -> required. */
export const SHIFT_LEFT = [
  { key: "touches_pii",    label: "Touches PII",          turnsOn: ["threat_model", "compliance_signoff"] },
  { key: "touches_auth",   label: "Touches auth / authz", turnsOn: ["threat_model", "security_review_approved"] },
  { key: "new_data_store", label: "New data store",       turnsOn: ["threat_model", "security_review_approved"] },
] as const;

/* ---------- Parallel sub-tracks (own mini state machines) ----------
   pending -> in_review -> (changes_requested <-> in_review) -> approved
   Run CONCURRENTLY; only feed the release gate, never block the spine. */
export const SUBTRACK_FLOW: Record<SubtrackState, SubtrackState[]> = {
  pending:           ["in_review"],
  in_review:         ["changes_requested", "approved"],
  changes_requested: ["in_review"],
  approved:          [],
};
export const SUBTRACK_LABELS: Record<SubtrackState, string> = {
  pending: "Pending",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export const REJECT_REASONS = ["duplicate", "out_of_scope", "wont_fix"];

/* =======================================================================
   DERIVATION — fold the event log into a live snapshot.
   ======================================================================= */
export function deriveItem(item: Item): Snapshot {
  const events = item.events.slice().sort((a, b) => a.ts - b.ts);

  let state: StateKey = "backlog";
  const conditions: Record<string, ConditionState> = {};
  const flags: Snapshot["flags"] = { blocked: null, on_hold: null };
  const signoffs: Snapshot["signoffs"] = {};
  const subtracks: Snapshot["subtracks"] = { security: "pending", compliance: "pending" };
  const children: string[] = [];

  // seed condition defaults from BOTH gates
  for (const g of Object.values(GATES))
    for (const c of g.conditions) conditions[c.key] = c.base;

  for (const e of events) {
    switch (e.type) {
      case "CREATE":
        state = (e.to as StateKey) || "backlog";
        break;
      case "TRANSITION":
        state = e.to as StateKey;
        break;
      case "CONDITION_SATISFY":
        if (e.condition) conditions[e.condition] = "satisfied";
        break;
      case "CONDITION_WAIVE":
        if (e.condition) conditions[e.condition] = "waived";
        break;
      case "CONDITION_RESET":
        if (e.condition) conditions[e.condition] = "required";
        break;
      case "SHIFT_LEFT_SET":
        // recomputed from the full set of active risks in second pass below
        break;
      case "GATE_SIGNOFF":
        if (e.gate) {
          signoffs[e.gate] = signoffs[e.gate] || { PM: null, Dev: null };
          signoffs[e.gate][e.role] = e.actor;
        }
        break;
      case "GATE_SIGNOFF_CLEAR":
        if (e.gate && signoffs[e.gate]) signoffs[e.gate][e.role] = null;
        break;
      case "SUBTRACK":
        if (e.track) subtracks[e.track] = e.to as SubtrackState;
        break;
      case "FLAG_SET":
        if (e.flag) flags[e.flag] = e.value ? { reason: e.reason ?? null } : null;
        break;
      case "SPAWN_CHILD":
        if (e.child) children.push(e.child);
        break;
    }
  }

  // ----- shift-left pass: active risks set conditional conditions required -----
  const activeRisks = new Set<string>();
  for (const e of events)
    if (e.type === "SHIFT_LEFT_SET" && e.risk) {
      if (e.value) activeRisks.add(e.risk);
      else activeRisks.delete(e.risk);
    }
  const turnedOn = new Set<string>();
  for (const r of SHIFT_LEFT)
    if (activeRisks.has(r.key)) r.turnsOn.forEach((k) => turnedOn.add(k));
  for (const g of Object.values(GATES))
    for (const c of g.conditions)
      if (c.conditional) {
        // only force to 'required' if not already explicitly satisfied/waived
        const cur = conditions[c.key];
        if (turnedOn.has(c.key)) {
          if (cur === "not_applicable") conditions[c.key] = "required";
        } else {
          if (cur === "required") conditions[c.key] = "not_applicable";
        }
      }

  // ----- sub-track approval auto-satisfies its linked release condition -----
  for (const c of GATES.release.conditions)
    if (c.track && subtracks[c.track] === "approved" && conditions[c.key] === "required")
      conditions[c.key] = "satisfied";

  return { state, conditions, flags, signoffs, subtracks, children, activeRisks, events };
}

/* ---------- Gate status (generic — same logic for every gate) ---------- */
export function gateStatus(gateKey: GateKey, snap: Snapshot): GateStatus {
  const gate = GATES[gateKey];
  const conds = gate.conditions.map((c) => ({ ...c, state: snap.conditions[c.key] }));
  const blocking = conds.filter((c) => c.state === "required");
  const signoff = snap.signoffs[gateKey] || { PM: null, Dev: null };
  const signoffComplete = !!signoff.PM && !!signoff.Dev;
  return {
    gate, conds, blocking, signoff, signoffComplete,
    open: blocking.length === 0 && signoffComplete,
  };
}

/* =======================================================================
   APPLY — the transition engine. Returns {ok, event} or a TYPED rejection.
   ======================================================================= */
export function legalTransitions(fromState: StateKey): TransitionDef[] {
  return TRANSITIONS.filter((t) => t.from === fromState);
}

export function applyTransition(
  item: Item,
  toState: StateKey,
  actor: string,
  role: Role,
  reason: string | null
): TransitionResult {
  const snap = deriveItem(item);
  const from = snap.state;
  const def = TRANSITIONS.find((t) => t.from === from && t.to === toState);

  if (!def)
    return rej("ILLEGAL_TRANSITION", `No transition from “${label(from)}” to “${label(toState)}”.`, { from, to: toState });

  if (!def.roles.includes(role))
    return rej("ROLE_GUARD", `${role} can’t perform “${def.label}”. Requires: ${def.roles.join(" or ")}.`,
      { actorRole: role, required: def.roles });

  if (def.gate) {
    const gs = gateStatus(def.gate, snap);
    if (gs.blocking.length)
      return rej("GATE_CONDITIONS_UNSATISFIED",
        `${gs.gate.label} gate blocked — ${gs.blocking.length} required condition${gs.blocking.length > 1 ? "s" : ""} unsatisfied.`,
        { gate: def.gate, conditions: gs.blocking.map((c) => c.key) });
    if (!gs.signoffComplete) {
      const missing = (["PM", "Dev"] as Role[]).filter((r) => !gs.signoff[r]);
      return rej("GATE_SIGNOFF_MISSING",
        `${gs.gate.label} gate needs dual sign-off — missing ${missing.join(" + ")} approval.`,
        { gate: def.gate, missing });
    }
  }

  if (def.needsReason === "reject" && (!reason || !REJECT_REASONS.includes(reason)))
    return rej("REASON_REQUIRED", `Rejection needs a reason: ${REJECT_REASONS.join(", ")}.`, { allowed: REJECT_REASONS });

  return { ok: true, event: ev(item.id, "TRANSITION", actor, role, { from, to: toState, reason: reason || null, kind: def.kind }) };
}

function rej(type: Rejection["type"], message: string, detail: Record<string, unknown>): TransitionResult {
  return { ok: false, rejection: { type, message, detail: detail || {} } };
}

export function label(s: string): string {
  return STATES[s as StateKey] ? STATES[s as StateKey].label : s;
}

/* ---------- event constructor ---------- */
let _seq = 0;
export function ev(
  itemId: string,
  type: EventType,
  actor: string,
  role: Role,
  payload?: Partial<PdlcEvent>
): PdlcEvent {
  return {
    id: "e" + ++_seq + "_" + Math.random().toString(36).slice(2, 6),
    item: itemId,
    type,
    actor,
    role,
    ts: Date.now(),
    ...(payload || {}),
  };
}

/* =======================================================================
   ANALYTICS — derived purely from the log.
   ======================================================================= */
export function timeInState(item: Item): Partial<Record<StateKey, number>> {
  const evs = item.events.filter((e) => e.type === "TRANSITION" || e.type === "CREATE").sort((a, b) => a.ts - b.ts);
  const out: Partial<Record<StateKey, number>> = {};
  for (let i = 0; i < evs.length; i++) {
    const cur = evs[i].to as StateKey;
    const end = i + 1 < evs.length ? evs[i + 1].ts : Date.now();
    out[cur] = (out[cur] || 0) + (end - evs[i].ts);
  }
  return out; // state -> ms
}

export function reworkRate(item: Item): number {
  return item.events.filter((e) => e.type === "TRANSITION" && e.kind === "rework").length;
}

export function leadTime(item: Item): number {
  const evs = item.events.slice().sort((a, b) => a.ts - b.ts);
  if (!evs.length) return 0;
  return Date.now() - evs[0].ts;
}

/* ---------- Plan vs actual ----------
   PHASE_BUDGET = expected calendar days per phase (org SLA defaults).
   A feature can override any phase via item.plan = { state: days }.
   Actual durations come from the event log (timeInState). */
const DAY_MS = 24 * 3600e3;
export const PHASE_BUDGET: Partial<Record<StateKey, number>> = {
  backlog: 2, in_discovery: 3, defined: 1, technical_design: 2,
  in_development: 5, in_code_review: 1.5, in_qa: 2, staging_uat: 1.5,
  deploying: 0.5, released: 1, monitoring: 7, done: 0,
};

export interface PvaPhase {
  key: StateKey;
  label: string;
  lane: Lane;
  expectedMs: number;
  actualMs: number;
  done: boolean;
  current: boolean;
  started: boolean;
  startTs: number | null;
  endTs: number | null;
}

export interface PvaResult {
  phases: PvaPhase[];
  expectedTotalMs: number;
  expectedToDateMs: number;
  actualElapsedMs: number;
  createdTs: number;
  targetTs: number;
  status: "shipped" | "closed" | "behind" | "ahead" | "on_track";
  off: boolean;
}

export function planVsActual(item: Item): PvaResult {
  const tis = timeInState(item);
  const st = deriveItem(item).state;
  const curSpine = STATES[st] ? STATES[st].spine ?? null : null;
  const off = !!STATES[st] && STATES[st].lane === "off";
  const budget = { ...PHASE_BUDGET, ...(item.plan || {}) };
  // first-entry / last-exit timestamps per phase (for exact date ranges)
  const spanEvs = item.events.filter((e) => e.type === "TRANSITION" || e.type === "CREATE").sort((a, b) => a.ts - b.ts);
  const firstTs: Partial<Record<StateKey, number>> = {};
  const lastEnd: Partial<Record<StateKey, number>> = {};
  for (let i = 0; i < spanEvs.length; i++) {
    const cur = spanEvs[i].to as StateKey;
    const start = spanEvs[i].ts;
    const end = i + 1 < spanEvs.length ? spanEvs[i + 1].ts : Date.now();
    if (firstTs[cur] == null) firstTs[cur] = start;
    lastEnd[cur] = end;
  }
  const order = Object.values(STATES).filter((s) => s.spine != null).sort((a, b) => a.spine! - b.spine!);
  let expectedTotalMs = 0, expectedToDateMs = 0;
  const phases: PvaPhase[] = order.map((s) => {
    const expectedMs = (budget[s.key] || 0) * DAY_MS;
    const actualMs = tis[s.key] || 0;
    const done = curSpine != null && s.spine! < curSpine;
    const current = s.key === st;
    const started = actualMs > 0 || done || current;
    expectedTotalMs += expectedMs;
    if (done || current || (curSpine == null && actualMs > 0)) expectedToDateMs += expectedMs;
    return {
      key: s.key, label: s.label, lane: s.lane, expectedMs, actualMs, done, current, started,
      startTs: firstTs[s.key] != null ? firstTs[s.key]! : null,
      endTs: lastEnd[s.key] != null ? lastEnd[s.key]! : null,
    };
  });
  const evs = item.events.slice().sort((a, b) => a.ts - b.ts);
  const createdTs = evs.length ? evs[0].ts : Date.now();
  const endTs = (st === "done" || off) && evs.length ? evs[evs.length - 1].ts : Date.now();
  const actualElapsedMs = endTs - createdTs;
  const targetTs = createdTs + expectedTotalMs;
  let status: PvaResult["status"];
  if (st === "done") status = "shipped";
  else if (off) status = "closed";
  else if (actualElapsedMs > expectedToDateMs * 1.1) status = "behind";
  else if (actualElapsedMs < expectedToDateMs * 0.9) status = "ahead";
  else status = "on_track";
  return { phases, expectedTotalMs, expectedToDateMs, actualElapsedMs, createdTs, targetTs, status, off };
}

export const spineOrder: StateDef[] = Object.values(STATES)
  .filter((s) => s.spine != null)
  .sort((a, b) => a.spine! - b.spine!);
