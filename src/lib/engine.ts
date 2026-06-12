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
export type WiPriority = 1 | 2 | 3 | 4; // 1 = highest
export type WiSeverity = 1 | 2 | 3 | 4; // 1 = Critical .. 4 = Low
/** SDLC phase a work item is bound to — the bridge between work items and the PDLC spine. */
export type WiPhase = "discovery" | "build" | "verify" | "release";
export type WiLinkType = "blocks" | "relates" | "duplicates";
export interface WiLink { type: WiLinkType; target: string; }
/** Item-level cross-item links (ITEM_LINK / ITEM_UNLINK) — same kinds as WI links.
 *  INFORMATIONAL v1: links never gate spine transitions (applyTransition stays
 *  single-item); the inverse direction is computed by callers via itemBlockedBy. */
export type ItemLinkKind = "blocks" | "relates" | "duplicates";
export interface ItemLink { to: string; linkKind: ItemLinkKind; }
/** Wire/event form of a work-item patch: null means "clear this field".
 *  (undefined doesn't survive JSON — DB payloads and HTTP both drop it.)
 *  customFields is a per-key DELTA: value null deletes that key. */
export type WiPatchWire =
  { [K in keyof Omit<WorkItem, "customFields">]?: Omit<WorkItem, "customFields">[K] | null }
  & { customFields?: Record<string, string | number | null> };
export type EventType =
  | "CREATE" | "TRANSITION" | "CONDITION_SATISFY" | "CONDITION_WAIVE"
  | "CONDITION_RESET" | "SHIFT_LEFT_SET" | "GATE_SIGNOFF" | "GATE_SIGNOFF_CLEAR"
  | "SUBTRACK" | "FLAG_SET" | "SPAWN_CHILD" | "ITEM_COMMENT" | "WATCH_SET"
  | "ITEM_LINK" | "ITEM_UNLINK"
  | "WI_CREATE" | "WI_UPDATE" | "WI_DELETE" | "WI_COMMENT" | "WI_WORKLOG"
  | "WI_LINK" | "WI_UNLINK" | "WI_REORDER";

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
  // TRANSITION/CREATE: StateKey · SUBTRACK: SubtrackState · ITEM_LINK/ITEM_UNLINK: target ITEM id
  to?: StateKey | SubtrackState | (string & {});
  kind?: TransitionKind;
  reason?: string | null;
  condition?: string;
  gate?: GateKey;
  track?: TrackKey;
  flag?: FlagKey;
  value?: boolean;
  risk?: string;
  child?: string;
  on?: boolean;             // WATCH_SET: true = actor starts watching, false = stops
  wiId?: string;            // target work-item id (WI_CREATE / WI_UPDATE / WI_DELETE / WI_COMMENT / WI_LINK / WI_UNLINK)
  wi?: WiPatchWire;         // WI_CREATE: full fields · WI_UPDATE: patch (null = clear the field — JSON-safe)
  text?: string;            // WI_COMMENT / ITEM_COMMENT body
  linkType?: WiLinkType;    // WI_LINK / WI_UNLINK
  linkTarget?: string;      // WI_LINK / WI_UNLINK: the other work item
  linkKind?: ItemLinkKind;  // ITEM_LINK / ITEM_UNLINK (the target item id travels in `to`)
  order?: string[];         // WI_REORDER: full ordered id list at the time of the event
  hours?: number;           // WI_WORKLOG: hours worked (> 0); `text` carries the optional note
}

export interface WiComment {
  id: string;
  author: string;
  role: Role;
  ts: number;
  text: string;
}

export interface WiWorklog {
  id: string;
  author: string;
  role: Role;
  ts: number;
  hours: number;
  text?: string;
}

export interface WorkItem {
  id: string;
  type: WiType;
  title: string;
  state: WiState;
  assignee: string;
  // Azure DevOps-style detail fields — all optional, so seed items stay unchanged.
  description?: string;
  acceptanceCriteria?: string;
  priority?: WiPriority;
  storyPoints?: number;       // >= 0
  severity?: WiSeverity;
  tags?: string[];            // trimmed, de-duped, non-empty
  comments?: WiComment[];     // DERIVED from WI_COMMENT events; omitted when none
  phase?: WiPhase;            // SDLC phase binding (drives board swimlanes + rollup context)
  sprint?: string;            // sprint/iteration name (free text, trimmed)
  dueDate?: string;           // ISO YYYY-MM-DD — plotted on the calendar view
  component?: string;         // component name (trimmed; per-project registry feeds the picker)
  links?: WiLink[];           // outgoing links; inverse direction is derived for display
  parentWiId?: string;        // subtask parent (one level — a parent can't itself be a subtask)
  originalEstimate?: number;  // hours >= 0
  remainingEstimate?: number; // hours >= 0; auto-decremented by worklogs (floor 0)
  timeSpent?: number;         // DERIVED from WI_WORKLOG events — total hours logged
  worklogs?: WiWorklog[];     // DERIVED from WI_WORKLOG events; omitted when none
  customFields?: Record<string, string | number>; // free-form custom field values (defs/admin: later phase)
}

export interface Stakeholder {
  role: string;
  name: string;
  derived?: boolean;
}

export interface Item {
  id: string;
  title: string;
  area: string;                  // display label only — grouping is by project
  priority: "High" | "Medium" | "Low";
  parent: string | null;
  project?: string | null;       // owning project id (items.project_id)
  fixVersion?: string | null;    // release membership (items.fix_version — metadata, not lifecycle)
  archivedAt?: string | null;    // ISO date-time when archived (items.archived_at) — hidden from views by default
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
  workItems: WorkItem[];
  activeRisks: Set<string>;
  comments: WiComment[];     // DERIVED from ITEM_COMMENT events — the item-level discussion thread
  watchers: Set<string>;     // DERIVED from WATCH_SET events — actor names currently watching
  links: ItemLink[];         // DERIVED from ITEM_LINK/ITEM_UNLINK — outgoing cross-item links (informational; never gate transitions)
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
      { key: "work_complete",            label: "Work items complete", owner: "Dev", base: "required" },
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
  // work items: seed baseline, then fold WI_* events on top (append-only; delete = tombstone)
  let workItems: WorkItem[] = (item.workItems || []).map((w) => {
    const copy = { ...w };
    if (w.tags) copy.tags = [...w.tags];
    if (w.links) copy.links = w.links.map((l) => ({ ...l }));
    return copy;
  });
  const worklogsByWi: Record<string, WiWorklog[]> = {}; // WI_WORKLOG entries per work item
  const commentsByWi: Record<string, WiComment[]> = {}; // WI_COMMENT thread per work item
  const comments: WiComment[] = [];                     // ITEM_COMMENT thread on the item itself
  const watchers = new Set<string>();                   // WATCH_SET: actor names currently watching
  let links: ItemLink[] = [];                           // ITEM_LINK/ITEM_UNLINK: outgoing cross-item links
  let wiOrder: string[] | null = null;                  // latest WI_REORDER wins

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
      case "ITEM_COMMENT":
        if (e.text) comments.push({ id: e.id, author: e.actor, role: e.role, ts: e.ts, text: e.text });
        break;
      case "WATCH_SET":
        if (e.on) watchers.add(e.actor);
        else watchers.delete(e.actor);
        break;
      case "ITEM_LINK":
        // informational v1 — links never gate transitions; self-links are rejected at the command level
        if (e.to && e.linkKind && !links.some((l) => l.to === e.to && l.linkKind === e.linkKind))
          links = [...links, { to: e.to, linkKind: e.linkKind }];
        break;
      case "ITEM_UNLINK":
        if (e.to && e.linkKind)
          links = links.filter((l) => !(l.to === e.to && l.linkKind === e.linkKind));
        break;
      case "WI_CREATE":
        if (e.wiId && !workItems.some((w) => w.id === e.wiId)) {
          const p = e.wi || {};
          const created: WorkItem = {
            id: e.wiId,
            type: (p.type as WiType) || "task",
            title: p.title ?? "",
            state: (p.state as WiState) || "todo",
            assignee: p.assignee ?? "",
          };
          // carry the optional detail fields when the create event supplies them
          if (p.description != null) created.description = p.description;
          if (p.acceptanceCriteria != null) created.acceptanceCriteria = p.acceptanceCriteria;
          if (p.priority != null) created.priority = p.priority;
          if (p.storyPoints != null) created.storyPoints = p.storyPoints;
          if (p.severity != null) created.severity = p.severity;
          if (p.tags != null) created.tags = normalizeTags(p.tags); // canonical + fresh array
          if (p.phase != null) created.phase = p.phase;
          if (p.sprint != null) created.sprint = p.sprint;
          if (p.parentWiId != null) created.parentWiId = p.parentWiId;
          if (p.dueDate != null) created.dueDate = p.dueDate;
          if (p.component != null) created.component = p.component;
          workItems = [...workItems, created];
        }
        break;
      case "WI_UPDATE":
        if (e.wiId)
          workItems = workItems.map((w) => {
            if (w.id !== e.wiId) return w;
            const merged: WorkItem = { ...w };
            const m = merged as unknown as Record<string, unknown>;
            for (const [k, v] of Object.entries(e.wi || {})) {
              if (k === "id") continue;            // id is immutable
              if (k === "customFields") continue;  // per-key delta — merged below
              if (v === null) delete m[k];         // null = clear
              else m[k] = v;
            }
            // never alias the immutable event payload's array into derived state
            if (e.wi && Array.isArray(e.wi.tags)) merged.tags = [...e.wi.tags];
            // customFields delta: value null deletes the key; an emptied map is dropped
            if (e.wi?.customFields) {
              const next: Record<string, string | number> = { ...(w.customFields || {}) };
              for (const [k, v] of Object.entries(e.wi.customFields)) {
                if (v === null) delete next[k];
                else next[k] = v;
              }
              if (Object.keys(next).length) merged.customFields = next;
              else delete merged.customFields;
            }
            return merged;
          });
        break;
      case "WI_DELETE":
        if (e.wiId) workItems = workItems.filter((w) => w.id !== e.wiId);
        break;
      case "WI_COMMENT":
        if (e.wiId && e.text) {
          if (!commentsByWi[e.wiId]) commentsByWi[e.wiId] = [];
          commentsByWi[e.wiId].push({ id: e.id, author: e.actor, role: e.role, ts: e.ts, text: e.text });
        }
        break;
      case "WI_WORKLOG":
        if (e.wiId && e.hours != null && e.hours > 0) {
          if (!worklogsByWi[e.wiId]) worklogsByWi[e.wiId] = [];
          worklogsByWi[e.wiId].push({ id: e.id, author: e.actor, role: e.role, ts: e.ts, hours: e.hours, ...(e.text ? { text: e.text } : {}) });
          workItems = workItems.map((w) => {
            if (w.id !== e.wiId) return w;
            const next: WorkItem = { ...w, timeSpent: (w.timeSpent || 0) + e.hours! };
            if (w.remainingEstimate != null) next.remainingEstimate = Math.max(0, w.remainingEstimate - e.hours!);
            return next;
          });
        }
        break;
      case "WI_LINK":
        if (e.wiId && e.linkType && e.linkTarget)
          workItems = workItems.map((w) => {
            if (w.id !== e.wiId) return w;
            const links = w.links || [];
            if (links.some((l) => l.type === e.linkType && l.target === e.linkTarget)) return w;
            return { ...w, links: [...links, { type: e.linkType!, target: e.linkTarget! }] };
          });
        break;
      case "WI_UNLINK":
        if (e.wiId && e.linkType && e.linkTarget)
          workItems = workItems.map((w) =>
            w.id !== e.wiId ? w : { ...w, links: (w.links || []).filter((l) => !(l.type === e.linkType && l.target === e.linkTarget)) });
        break;
      case "WI_REORDER":
        if (e.order) wiOrder = e.order;
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

  // ----- manual rank: latest WI_REORDER wins; ids created later append at the end -----
  if (wiOrder) {
    const idx = new Map(wiOrder.map((id, i) => [id, i]));
    const ranked = workItems.filter((w) => idx.has(w.id)).sort((a, b) => idx.get(a.id)! - idx.get(b.id)!);
    const rest = workItems.filter((w) => !idx.has(w.id));
    workItems = [...ranked, ...rest];
  }

  // ----- drop links whose target no longer exists (tombstoned) -----
  const liveIds = new Set(workItems.map((w) => w.id));
  workItems = workItems.map((w) => {
    if (!w.links) return w;
    const kept = w.links.filter((l) => liveIds.has(l.target));
    return kept.length === w.links.length ? w : { ...w, links: kept };
  });

  // ----- orphan subtasks whose parent no longer exists (tombstoned) -----
  workItems = workItems.map((w) => {
    if (!w.parentWiId || liveIds.has(w.parentWiId)) return w;
    const { parentWiId: _dropped, ...rest } = w;
    return rest;
  });

  // ----- SDLC→PDLC rollup: all work items done auto-satisfies the release condition -----
  // (vacuously satisfied with zero work items; an explicit satisfy/waive event always wins)
  if (conditions.work_complete === "required" && workItems.every((w) => w.state === "done"))
    conditions.work_complete = "satisfied";

  // attach derived comment threads (omit when none, to keep comment-less items' shape stable)
  workItems = workItems.map((w) => (commentsByWi[w.id] ? { ...w, comments: commentsByWi[w.id] } : w));
  // attach derived worklogs (same omit-when-none convention)
  workItems = workItems.map((w) => (worklogsByWi[w.id] ? { ...w, worklogs: worklogsByWi[w.id] } : w));

  return { state, conditions, flags, signoffs, subtracks, children, workItems, activeRisks, comments, watchers, links, events };
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
   WORK ITEMS — CRUD expressed as events (same model as the rest of the app).
   Validators are pure: they return {ok, event} or {ok:false, error}. The UI
   appends the event and re-derives; deriveItem folds WI_* onto the baseline.
   Both roles may create/update/delete (work items are shared task tracking);
   actor/role are still recorded on the event for History.
   ======================================================================= */
export type WiResult = { ok: true; event: PdlcEvent } | { ok: false; error: string };

// Runtime enum lists for boundary validation (the type-level unions can't be checked at runtime).
export const WI_TYPES_ALL: WiType[] = ["epic", "feature", "story", "task", "bug"];
export const WI_STATES_ALL: WiState[] = ["todo", "in_progress", "in_review", "blocked", "done"];
const WI_TYPE_SET = new Set<string>(WI_TYPES_ALL);
const WI_STATE_SET = new Set<string>(WI_STATES_ALL);

export const WI_PHASES_ALL: WiPhase[] = ["discovery", "build", "verify", "release"];
export const WI_PHASE_LABELS: Record<WiPhase, string> = {
  discovery: "Discovery", build: "Build", verify: "Verify", release: "Release",
};
const WI_PHASE_SET = new Set<string>(WI_PHASES_ALL);

export const WI_LINK_TYPES: WiLinkType[] = ["blocks", "relates", "duplicates"];
export const WI_LINK_LABELS: Record<WiLinkType, { out: string; in: string }> = {
  blocks:     { out: "blocks",        in: "blocked by" },
  relates:    { out: "relates to",    in: "relates to" },
  duplicates: { out: "duplicates",    in: "duplicated by" },
};
const WI_LINK_SET = new Set<string>(WI_LINK_TYPES);
const SYMMETRIC_LINKS = new Set<WiLinkType>(["relates", "duplicates"]);

/* ---------- Item-level links (cross-item dependencies) ----------
   Same kinds + labels as WI links, but between ITEMS (ITEM_LINK / ITEM_UNLINK
   events fold into Snapshot.links). INFORMATIONAL v1: links never gate spine
   transitions — applyTransition keeps its single-item signature and never
   consults other items. The inverse ("blocked by") direction is computed by
   callers from the other items via itemBlockedBy, exactly like wiBlockedBy. */
export const ITEM_LINK_KINDS: ItemLinkKind[] = ["blocks", "relates", "duplicates"];
export const ITEM_LINK_LABELS: Record<ItemLinkKind, { out: string; in: string }> = {
  blocks:     { out: "blocks",        in: "blocked by" },
  relates:    { out: "relates to",    in: "relates to" },
  duplicates: { out: "duplicates",    in: "duplicated by" },
};

/** All inbound links pointing at `item`, for display (every kind, any state —
 *  unlike itemBlockedBy, which only counts OPEN `blocks` sources). Pure;
 *  callers pass the full item list. Sorted by source id, then link kind. */
export function itemInboundLinks(item: Item, all: Item[]): { from: string; linkKind: ItemLinkKind }[] {
  return all
    .filter((other) => other.id !== item.id)
    .flatMap((other) =>
      deriveItem(other).links
        .filter((l) => l.to === item.id)
        .map((l) => ({ from: other.id, linkKind: l.linkKind })),
    )
    .sort((a, b) => (a.from === b.from ? a.linkKind.localeCompare(b.linkKind) : a.from.localeCompare(b.from)));
}

/** Ids of OPEN items (not done / closed-lane) whose snapshot carries a `blocks`
 *  link pointing at `item`. Pure; callers pass the full item list. */
export function itemBlockedBy(item: Item, all: Item[]): string[] {
  return all
    .filter((other) => {
      if (other.id === item.id) return false;
      const snap = deriveItem(other);
      if (STATES[snap.state].lane === "closed") return false; // done — no longer blocks
      return snap.links.some((l) => l.linkKind === "blocks" && l.to === item.id);
    })
    .map((o) => o.id);
}

/* ---------- Work-item workflow (declarative, per type — same philosophy as TRANSITIONS) ----------
   transitionWorkItem enforces these moves (and open blockers); updateWorkItem stays a
   free-form admin edit so the detail form can correct any field, state included. */
export const WI_FLOW_BASE: Record<WiState, WiState[]> = {
  todo:        ["in_progress"],
  in_progress: ["in_review", "blocked", "todo"],
  in_review:   ["done", "in_progress"],
  blocked:     ["in_progress", "todo"],
  done:        ["todo"],
};
export const WI_FLOW_OVERRIDES: Partial<Record<WiType, Partial<Record<WiState, WiState[]>>>> = {
  bug: { done: ["in_progress"] }, // a reopened bug goes straight back to fixing
};
export function wiFlow(type: WiType): Record<WiState, WiState[]> {
  return { ...WI_FLOW_BASE, ...(WI_FLOW_OVERRIDES[type] || {}) };
}
export function legalWiMoves(wi: WorkItem): WiState[] {
  return wiFlow(wi.type)[wi.state] || [];
}

export const WI_PRIORITIES: WiPriority[] = [1, 2, 3, 4];
export const WI_SEVERITIES: WiSeverity[] = [1, 2, 3, 4];
export const WI_PRIORITY_LABELS: Record<WiPriority, string> = { 1: "1 · Highest", 2: "2 · High", 3: "3 · Medium", 4: "4 · Low" };
export const WI_SEVERITY_LABELS: Record<WiSeverity, string> = { 1: "1 · Critical", 2: "2 · High", 3: "3 · Medium", 4: "4 · Low" };
const WI_PRIORITY_SET = new Set<number>(WI_PRIORITIES);
const WI_SEVERITY_SET = new Set<number>(WI_SEVERITIES);

/** Clean a tag list: trim, drop empties, de-dupe (exact), preserve order. */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const v = (t || "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

/** Next free id: PREFIX-(max numeric suffix + 1), min PREFIX-100.
 *  Scans EVERY id that has ever existed for this item — live items, the seed baseline,
 *  and every prior WI_CREATE / WI_DELETE — so a tombstoned id is never reused (monotonic). */
export function nextWorkItemId(item: Item, snap: Snapshot): string {
  const prefix = item.id.split("-")[0];
  const used = new Set<string>(snap.workItems.map((w) => w.id));
  for (const w of item.workItems || []) used.add(w.id);
  for (const e of item.events) if ((e.type === "WI_CREATE" || e.type === "WI_DELETE") && e.wiId) used.add(e.wiId);
  let max = 99;
  for (const id of used)
    if (id.startsWith(prefix + "-")) {
      const n = Number(id.slice(prefix.length + 1));
      if (Number.isFinite(n) && n > max) max = n;
    }
  return `${prefix}-${max + 1}`;
}

/** Strict ISO calendar date (YYYY-MM-DD) that survives a Date round-trip
 *  (rejects impossible dates like 2026-02-30). */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Validate a subtask parent: must exist and must not itself be a subtask (one level). */
function parentWiError(snap: Snapshot, parentWiId: string, selfId?: string): string | null {
  if (selfId !== undefined && parentWiId === selfId) return "A work item can’t be its own parent.";
  const parent = snap.workItems.find((w) => w.id === parentWiId);
  if (!parent) return `Parent work item ${parentWiId} not found.`;
  if (parent.parentWiId) return `${parentWiId} is itself a subtask — subtasks nest one level only.`;
  if (selfId !== undefined && snap.workItems.some((w) => w.parentWiId === selfId))
    return `${selfId} has subtasks of its own — it can’t become a subtask.`;
  return null;
}

export function createWorkItem(
  item: Item, snap: Snapshot,
  draft: { type: WiType; title: string; assignee: string; state?: WiState; phase?: WiPhase; sprint?: string; parentWiId?: string; dueDate?: string; component?: string },
  actor: string, role: Role
): WiResult {
  const title = (draft.title || "").trim();
  if (!title) return { ok: false, error: "Work item needs a title." };
  if (!WI_TYPE_SET.has(draft.type)) return { ok: false, error: `Invalid work-item type "${draft.type}".` };
  if (draft.state !== undefined && !WI_STATE_SET.has(draft.state))
    return { ok: false, error: `Invalid work-item state "${draft.state}".` };
  if (draft.phase !== undefined && !WI_PHASE_SET.has(draft.phase))
    return { ok: false, error: `Invalid phase "${draft.phase}".` };
  if (draft.parentWiId !== undefined) {
    const err = parentWiError(snap, draft.parentWiId);
    if (err) return { ok: false, error: err };
  }
  if (draft.dueDate !== undefined && !isIsoDate(draft.dueDate))
    return { ok: false, error: "Due date must be a valid YYYY-MM-DD date." };
  const id = nextWorkItemId(item, snap);
  if (snap.workItems.some((w) => w.id === id))
    return { ok: false, error: `Work item ${id} already exists.` };
  const wi: Partial<WorkItem> = {
    type: draft.type,
    title,
    state: draft.state || "todo",
    assignee: (draft.assignee || "").trim(),
  };
  if (draft.phase !== undefined) wi.phase = draft.phase;
  const sprint = (draft.sprint || "").trim();
  if (sprint) wi.sprint = sprint;
  if (draft.parentWiId !== undefined) wi.parentWiId = draft.parentWiId;
  if (draft.dueDate !== undefined) wi.dueDate = draft.dueDate;
  const component = (draft.component || "").trim();
  if (component) wi.component = component;
  return { ok: true, event: ev(item.id, "WI_CREATE", actor, role, { wiId: id, wi }) };
}

export function updateWorkItem(
  item: Item, snap: Snapshot, wiId: string, patch: Partial<WorkItem>,
  actor: string, role: Role
): WiResult {
  const cur = snap.workItems.find((w) => w.id === wiId);
  if (!cur) return { ok: false, error: `Work item ${wiId} not found.` };
  if (patch.type !== undefined && !WI_TYPE_SET.has(patch.type))
    return { ok: false, error: `Invalid work-item type "${patch.type}".` };
  if (patch.state !== undefined && !WI_STATE_SET.has(patch.state))
    return { ok: false, error: `Invalid work-item state "${patch.state}".` };
  if (patch.title !== undefined && !patch.title.trim())
    return { ok: false, error: "Work item needs a title." };
  if (patch.priority !== undefined && !WI_PRIORITY_SET.has(patch.priority))
    return { ok: false, error: `Invalid priority "${patch.priority}".` };
  if (patch.severity !== undefined && !WI_SEVERITY_SET.has(patch.severity))
    return { ok: false, error: `Invalid severity "${patch.severity}".` };
  if (patch.storyPoints !== undefined && (!Number.isFinite(patch.storyPoints) || patch.storyPoints < 0))
    return { ok: false, error: "Story points must be a number ≥ 0." };
  if (patch.originalEstimate !== undefined && (!Number.isFinite(patch.originalEstimate) || patch.originalEstimate < 0))
    return { ok: false, error: "Original estimate must be a number of hours ≥ 0." };
  if (patch.remainingEstimate !== undefined && (!Number.isFinite(patch.remainingEstimate) || patch.remainingEstimate < 0))
    return { ok: false, error: "Remaining estimate must be a number of hours ≥ 0." };
  if (patch.tags !== undefined && !Array.isArray(patch.tags))
    return { ok: false, error: "Tags must be a list." };
  if (patch.dueDate !== undefined && !isIsoDate(patch.dueDate))
    return { ok: false, error: "Due date must be a valid YYYY-MM-DD date." };
  if (patch.phase !== undefined && !WI_PHASE_SET.has(patch.phase))
    return { ok: false, error: `Invalid phase "${patch.phase}".` };
  // Effective patch = only the fields that actually change (id is immutable).
  // Keeps the log clean and honours the "wi = only changed fields" event convention.
  // Cleared fields are stored as null in the event — JSON-safe (undefined would be
  // silently dropped by the DB payload and the HTTP response).
  const wi: WiPatchWire = {};
  if (patch.type !== undefined && patch.type !== cur.type) wi.type = patch.type;
  if (patch.state !== undefined && patch.state !== cur.state) wi.state = patch.state;
  if (patch.title !== undefined && patch.title.trim() !== cur.title) wi.title = patch.title.trim();
  if (patch.assignee !== undefined && patch.assignee.trim() !== cur.assignee) wi.assignee = patch.assignee.trim();
  if (patch.description !== undefined && patch.description !== cur.description) wi.description = patch.description;
  if (patch.acceptanceCriteria !== undefined && patch.acceptanceCriteria !== cur.acceptanceCriteria) wi.acceptanceCriteria = patch.acceptanceCriteria;
  // nullable scalars: "key in patch" lets an explicit undefined clear a set value
  if ("priority" in patch && patch.priority !== cur.priority) wi.priority = patch.priority ?? null;
  if ("storyPoints" in patch && patch.storyPoints !== cur.storyPoints) wi.storyPoints = patch.storyPoints ?? null;
  if ("severity" in patch && patch.severity !== cur.severity) wi.severity = patch.severity ?? null;
  if ("originalEstimate" in patch && patch.originalEstimate !== cur.originalEstimate) wi.originalEstimate = patch.originalEstimate ?? null;
  if ("remainingEstimate" in patch && patch.remainingEstimate !== cur.remainingEstimate) wi.remainingEstimate = patch.remainingEstimate ?? null;
  if ("phase" in patch && patch.phase !== cur.phase) wi.phase = patch.phase ?? null;
  if ("dueDate" in patch && patch.dueDate !== cur.dueDate) wi.dueDate = patch.dueDate ?? null;
  if ("sprint" in patch) {
    const v = (patch.sprint ?? "").trim() || undefined;
    if (v !== cur.sprint) wi.sprint = v ?? null;
  }
  if ("component" in patch) {
    const v = (patch.component ?? "").trim() || undefined;
    if (v !== cur.component) wi.component = v ?? null;
  }
  if (patch.tags !== undefined) {
    const norm = normalizeTags(patch.tags);
    if (!sameTags(norm, cur.tags || [])) wi.tags = norm;
  }
  if ("parentWiId" in patch && patch.parentWiId !== cur.parentWiId) {
    if (patch.parentWiId !== undefined) {
      const err = parentWiError(snap, patch.parentWiId, wiId);
      if (err) return { ok: false, error: err };
    }
    wi.parentWiId = patch.parentWiId ?? null;
  }
  if (patch.customFields !== undefined) {
    // per-key delta: value null deletes the key; only keys that actually change are emitted
    const cf = patch.customFields as Record<string, string | number | null>;
    const entries = Object.entries(cf);
    if (entries.length > 20) return { ok: false, error: "At most 20 custom fields per change." };
    for (const [k, v] of entries) {
      if (!k.trim() || k.length > 64) return { ok: false, error: "Custom field keys must be 1–64 characters." };
      if (v !== null && typeof v !== "string" && !(typeof v === "number" && Number.isFinite(v)))
        return { ok: false, error: "Custom field values must be text or a number." };
      if (typeof v === "string" && v.length > 2000) return { ok: false, error: "Custom field values are capped at 2000 characters." };
    }
    const curCf = cur.customFields || {};
    const delta: Record<string, string | number | null> = {};
    for (const [k, v] of entries) {
      if (v === null) { if (k in curCf) delta[k] = null; }
      else if (curCf[k] !== v) delta[k] = v;
    }
    if (Object.keys(delta).length) wi.customFields = delta;
  }
  if (Object.keys(wi).length === 0) return { ok: false, error: "No changes to save." };
  return { ok: true, event: ev(item.id, "WI_UPDATE", actor, role, { wiId, wi }) };
}

export function deleteWorkItem(
  item: Item, snap: Snapshot, wiId: string, actor: string, role: Role
): WiResult {
  if (!snap.workItems.some((w) => w.id === wiId))
    return { ok: false, error: `Work item ${wiId} not found.` };
  return { ok: true, event: ev(item.id, "WI_DELETE", actor, role, { wiId }) };
}

/** Log hours worked on a work item (append-only). The fold accumulates
 *  timeSpent and decrements remainingEstimate (floor 0). */
export function logWork(
  item: Item, snap: Snapshot, wiId: string, hours: number, note: string, actor: string, role: Role
): WiResult {
  if (!snap.workItems.some((w) => w.id === wiId))
    return { ok: false, error: `Work item ${wiId} not found.` };
  if (!Number.isFinite(hours) || hours <= 0)
    return { ok: false, error: "Logged time must be a number of hours > 0." };
  const text = (note || "").trim();
  return { ok: true, event: ev(item.id, "WI_WORKLOG", actor, role, { wiId, hours, ...(text ? { text } : {}) }) };
}

/** Post a comment to a work item's discussion thread (append-only). */
export function commentWorkItem(
  item: Item, snap: Snapshot, wiId: string, text: string, author: string, role: Role
): WiResult {
  if (!snap.workItems.some((w) => w.id === wiId))
    return { ok: false, error: `Work item ${wiId} not found.` };
  const body = (text || "").trim();
  if (!body) return { ok: false, error: "Comment can’t be empty." };
  return { ok: true, event: ev(item.id, "WI_COMMENT", author, role, { wiId, text: body }) };
}

/* ---------- WI workflow transition (flow-table + blocker enforced) ---------- */

/** Direct subtasks of `wiId` (one level — see parentWiId). */
export function wiSubtasks(snap: Snapshot, wiId: string): WorkItem[] {
  return snap.workItems.filter((w) => w.parentWiId === wiId);
}

/** Ids of OPEN work items that declare a `blocks` link onto `wiId`. */
export function wiBlockedBy(snap: Snapshot, wiId: string): string[] {
  return snap.workItems
    .filter((w) => w.state !== "done" && (w.links || []).some((l) => l.type === "blocks" && l.target === wiId))
    .map((w) => w.id);
}

const WI_STATE_LABELS: Record<WiState, string> = {
  todo: "To do", in_progress: "In progress", in_review: "In review", blocked: "Blocked", done: "Done",
};

/** Move a work item along its type's flow table. Rejects illegal moves and
 *  (for moves to done) open blockers. Emits a state-only WI_UPDATE. */
export function transitionWorkItem(
  item: Item, snap: Snapshot, wiId: string, to: WiState, actor: string, role: Role
): WiResult {
  const cur = snap.workItems.find((w) => w.id === wiId);
  if (!cur) return { ok: false, error: `Work item ${wiId} not found.` };
  if (!WI_STATE_SET.has(to)) return { ok: false, error: `Invalid work-item state "${to}".` };
  if (to === cur.state) return { ok: false, error: `${wiId} is already ${WI_STATE_LABELS[to]}.` };
  const legal = legalWiMoves(cur);
  if (!legal.includes(to))
    return {
      ok: false,
      error: `${wiId} can’t move ${WI_STATE_LABELS[cur.state]} → ${WI_STATE_LABELS[to]}. Legal: ${legal.map((s) => WI_STATE_LABELS[s]).join(", ") || "none"}.`,
    };
  if (to === "done") {
    const blockers = wiBlockedBy(snap, wiId);
    if (blockers.length)
      return { ok: false, error: `${wiId} is blocked by open ${blockers.length > 1 ? "items" : "item"} ${blockers.join(", ")} — finish or unlink them first.` };
    const openSubs = wiSubtasks(snap, wiId).filter((w) => w.state !== "done");
    if (openSubs.length)
      return { ok: false, error: `${wiId} has ${openSubs.length} open subtask${openSubs.length > 1 ? "s" : ""} (${openSubs.map((w) => w.id).join(", ")}) — finish them first.` };
  }
  return { ok: true, event: ev(item.id, "WI_UPDATE", actor, role, { wiId, wi: { state: to } }) };
}

/* ---------- WI links ---------- */
export function linkWorkItems(
  item: Item, snap: Snapshot, fromId: string, type: WiLinkType, targetId: string, actor: string, role: Role
): WiResult {
  if (!WI_LINK_SET.has(type)) return { ok: false, error: `Invalid link type "${type}".` };
  const from = snap.workItems.find((w) => w.id === fromId);
  if (!from) return { ok: false, error: `Work item ${fromId} not found.` };
  const target = snap.workItems.find((w) => w.id === targetId);
  if (!target) return { ok: false, error: `Work item ${targetId} not found.` };
  if (fromId === targetId) return { ok: false, error: "A work item can’t link to itself." };
  if ((from.links || []).some((l) => l.type === type && l.target === targetId))
    return { ok: false, error: `${fromId} already ${WI_LINK_LABELS[type].out} ${targetId}.` };
  if (SYMMETRIC_LINKS.has(type) && (target.links || []).some((l) => l.type === type && l.target === fromId))
    return { ok: false, error: `${targetId} already ${WI_LINK_LABELS[type].out} ${fromId}.` };
  return { ok: true, event: ev(item.id, "WI_LINK", actor, role, { wiId: fromId, linkType: type, linkTarget: targetId }) };
}

export function unlinkWorkItems(
  item: Item, snap: Snapshot, fromId: string, type: WiLinkType, targetId: string, actor: string, role: Role
): WiResult {
  const from = snap.workItems.find((w) => w.id === fromId);
  if (!from) return { ok: false, error: `Work item ${fromId} not found.` };
  if (!(from.links || []).some((l) => l.type === type && l.target === targetId))
    return { ok: false, error: `No "${type}" link from ${fromId} to ${targetId}.` };
  return { ok: true, event: ev(item.id, "WI_UNLINK", actor, role, { wiId: fromId, linkType: type, linkTarget: targetId }) };
}

/* ---------- WI manual ranking ---------- */
export function reorderWorkItem(
  item: Item, snap: Snapshot, wiId: string, toIndex: number, actor: string, role: Role
): WiResult {
  const ids = snap.workItems.map((w) => w.id);
  const fromIdx = ids.indexOf(wiId);
  if (fromIdx === -1) return { ok: false, error: `Work item ${wiId} not found.` };
  const clamped = Math.max(0, Math.min(ids.length - 1, Math.trunc(toIndex)));
  if (clamped === fromIdx) return { ok: false, error: "No changes to save." };
  const order = ids.filter((id) => id !== wiId);
  order.splice(clamped, 0, wiId);
  return { ok: true, event: ev(item.id, "WI_REORDER", actor, role, { order }) };
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
