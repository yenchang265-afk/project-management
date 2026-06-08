/* =========================================================================
   PDLC ENGINE — pure, event-sourced state machine.
   No React, no DOM. Everything here is data + pure functions.
   The single source of truth is the append-only event log; current state,
   gate conditions, flags, sign-offs, sub-tracks and analytics are all
   DERIVED by folding events.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------- Roles ---------- */
  const ROLES = { PM: "PM", DEV: "Dev" };

  /* ---------- States ----------
     type: spine | gate-pending | terminal | recovery
     lane: discovery | build | verify | release | closed | off
     The "gate" is modeled as a property on transitions, NOT bespoke states. */
  const STATES = {
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
  const GATE_BEFORE = { in_development: "ready_for_dev", deploying: "release" };

  /* ---------- Transition table (declarative — the ONLY place rules live) ----------
     kind: forward | rework | terminal | recovery | hotfix
     gate: references a gate definition; engine applies generic gate logic.
     roles: who may perform the transition (role guard).                        */
  const TRANSITIONS = [
    // ---- happy-path spine ----
    { from: "backlog",          to: "in_discovery",     roles: ["PM"],       kind: "forward", label: "Start discovery" },
    { from: "in_discovery",     to: "defined",          roles: ["PM"],       kind: "forward", label: "Mark defined" },
    { from: "defined",          to: "technical_design", roles: ["Dev"],      kind: "forward", label: "Pick up tech design" },
    { from: "technical_design", to: "in_development",   roles: ["PM","Dev"], kind: "forward", gate: "ready_for_dev", label: "Open Ready-for-dev gate" },
    { from: "in_development",   to: "in_code_review",   roles: ["Dev"],      kind: "forward", label: "Submit for review" },
    { from: "in_code_review",   to: "in_qa",            roles: ["Dev"],      kind: "forward", label: "Approve review → QA" },
    { from: "in_qa",            to: "staging_uat",      roles: ["Dev"],      kind: "forward", label: "Promote to Staging/UAT" },
    { from: "staging_uat",      to: "deploying",        roles: ["PM","Dev"], kind: "forward", gate: "release", label: "Open Release gate" },
    { from: "deploying",        to: "released",         roles: ["Dev"],      kind: "forward", label: "Confirm release" },
    { from: "released",         to: "monitoring",       roles: ["Dev"],      kind: "forward", label: "Begin monitoring" },
    { from: "monitoring",       to: "done",             roles: ["PM"],       kind: "forward", label: "Close out → Done" },

    // ---- rework loops (backward) ----
    { from: "defined",          to: "in_discovery",     roles: ["PM"],  kind: "rework", label: "Reopen discovery" },
    { from: "in_code_review",   to: "in_development",   roles: ["Dev"], kind: "rework", label: "Request changes" },
    { from: "in_qa",            to: "in_development",   roles: ["Dev"], kind: "rework", label: "QA failed → dev" },
    { from: "staging_uat",      to: "in_development",   roles: ["PM"],  kind: "rework", label: "Reject PM acceptance" },

    // ---- terminals (early states only) ----
    ...["backlog","in_discovery","defined","technical_design"].flatMap((s) => [
      { from: s, to: "rejected", roles: ["PM"], kind: "terminal", label: "Reject", needsReason: "reject" },
      { from: s, to: "deferred", roles: ["PM"], kind: "terminal", label: "Defer",  needsReason: "free" },
    ]),

    // ---- post-release recovery ----
    { from: "released",   to: "rolled_back",  roles: ["Dev"], kind: "recovery", label: "Roll back", needsReason: "free" },
    { from: "monitoring", to: "rolled_back",  roles: ["Dev"], kind: "recovery", label: "Roll back", needsReason: "free" },
    { from: "rolled_back",to: "in_development",roles: ["Dev"], kind: "hotfix",  label: "Hotfix → dev" },
    { from: "monitoring", to: "in_development",roles: ["Dev"], kind: "hotfix",  label: "Hotfix (expedite)" },
  ];

  /* ---------- Conditions & gates ----------
     Each condition: { key, label, owner, base } where base is the DEFAULT state:
       required        — must be satisfied for the gate to open
       not_applicable  — conditional; the shift-left checklist can flip it on
     Live states a condition can hold: required | satisfied | waived | not_applicable */
  const GATES = {
    ready_for_dev: {
      key: "ready_for_dev",
      label: "Ready for dev",
      conditions: [
        { key: "spec_approved",  label: "Spec approved",   owner: "PM",  base: "required" },
        { key: "design_reviewed",label: "Design reviewed", owner: "Dev", base: "required" },
        { key: "estimated",      label: "Estimated",       owner: "Dev", base: "required" },
        { key: "threat_model",   label: "Threat model",    owner: "Dev", base: "not_applicable", conditional: true },
      ],
    },
    release: {
      key: "release",
      label: "Release",
      conditions: [
        { key: "qa_passed",        label: "QA passed",         owner: "Dev", base: "required" },
        { key: "pm_acceptance",    label: "PM acceptance",     owner: "PM",  base: "required" },
        { key: "docs_runbook_ready",label: "Docs & runbook",   owner: "Dev", base: "required" },
        { key: "security_review_approved", label: "Security review", owner: "Dev", base: "not_applicable", conditional: true, track: "security" },
        { key: "compliance_signoff",       label: "Compliance sign-off", owner: "PM", base: "not_applicable", conditional: true, track: "compliance" },
      ],
    },
  };

  /* ---------- Shift-left checklist ----------
     Ticking a risk flips its mapped conditional conditions not_applicable -> required. */
  const SHIFT_LEFT = [
    { key: "touches_pii",      label: "Touches PII",          turnsOn: ["threat_model", "compliance_signoff"] },
    { key: "touches_auth",     label: "Touches auth / authz", turnsOn: ["threat_model", "security_review_approved"] },
    { key: "new_data_store",   label: "New data store",       turnsOn: ["threat_model", "security_review_approved"] },
  ];

  /* ---------- Parallel sub-tracks (own mini state machines) ----------
     pending -> in_review -> (changes_requested <-> in_review) -> approved
     Run CONCURRENTLY; only feed the release gate, never block the spine. */
  const SUBTRACK_FLOW = {
    pending:            ["in_review"],
    in_review:          ["changes_requested", "approved"],
    changes_requested:  ["in_review"],
    approved:           [],
  };
  const SUBTRACK_LABELS = {
    pending: "Pending", in_review: "In review",
    changes_requested: "Changes requested", approved: "Approved",
  };

  const REJECT_REASONS = ["duplicate", "out_of_scope", "wont_fix"];

  /* =======================================================================
     DERIVATION — fold the event log into a live snapshot.
     ======================================================================= */
  function deriveItem(item) {
    const events = item.events.slice().sort((a, b) => a.ts - b.ts);

    let state = "backlog";
    const conditions = {};   // key -> live state
    const flags = { blocked: null, on_hold: null }; // null or { reason }
    const signoffs = {};     // gateKey -> { PM: actor|null, Dev: actor|null }
    const subtracks = { security: "pending", compliance: "pending" };
    const children = [];

    // seed condition defaults from BOTH gates
    for (const g of Object.values(GATES))
      for (const c of g.conditions) conditions[c.key] = c.base;

    for (const e of events) {
      switch (e.type) {
        case "CREATE":
          state = e.to || "backlog";
          break;
        case "TRANSITION":
          state = e.to;
          break;
        case "CONDITION_SATISFY":
          conditions[e.condition] = "satisfied";
          break;
        case "CONDITION_WAIVE":
          conditions[e.condition] = "waived";
          break;
        case "CONDITION_RESET":
          conditions[e.condition] = "required";
          break;
        case "SHIFT_LEFT_SET": {
          // recompute conditional conditions from the full set of active risks
          break; // handled in second pass below
        }
        case "GATE_SIGNOFF":
          signoffs[e.gate] = signoffs[e.gate] || { PM: null, Dev: null };
          signoffs[e.gate][e.role] = e.actor;
          break;
        case "GATE_SIGNOFF_CLEAR":
          if (signoffs[e.gate]) signoffs[e.gate][e.role] = null;
          break;
        case "SUBTRACK":
          subtracks[e.track] = e.to;
          break;
        case "FLAG_SET":
          flags[e.flag] = e.value ? { reason: e.reason } : null;
          break;
        case "SPAWN_CHILD":
          children.push(e.child);
          break;
      }
    }

    // ----- shift-left pass: active risks set conditional conditions required -----
    const activeRisks = new Set();
    for (const e of events)
      if (e.type === "SHIFT_LEFT_SET") {
        if (e.value) activeRisks.add(e.risk);
        else activeRisks.delete(e.risk);
      }
    const turnedOn = new Set();
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
  function gateStatus(gateKey, snap) {
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
  function legalTransitions(fromState) {
    return TRANSITIONS.filter((t) => t.from === fromState);
  }

  function applyTransition(item, toState, actor, role, reason) {
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
        const missing = ["PM", "Dev"].filter((r) => !gs.signoff[r]);
        return rej("GATE_SIGNOFF_MISSING",
          `${gs.gate.label} gate needs dual sign-off — missing ${missing.join(" + ")} approval.`,
          { gate: def.gate, missing });
      }
    }

    if (def.needsReason === "reject" && !REJECT_REASONS.includes(reason))
      return rej("REASON_REQUIRED", `Rejection needs a reason: ${REJECT_REASONS.join(", ")}.`, { allowed: REJECT_REASONS });

    return { ok: true, event: ev(item.id, "TRANSITION", actor, role, { from, to: toState, reason: reason || null, kind: def.kind }) };
  }

  function rej(type, message, detail) { return { ok: false, rejection: { type, message, detail: detail || {} } }; }
  function label(s) { return STATES[s] ? STATES[s].label : s; }

  /* ---------- event constructor ---------- */
  let _seq = 0;
  function ev(itemId, type, actor, role, payload) {
    return Object.assign({ id: "e" + (++_seq) + "_" + Math.random().toString(36).slice(2, 6), item: itemId, type, actor, role, ts: Date.now() }, payload || {});
  }

  /* =======================================================================
     ANALYTICS — derived purely from the log.
     ======================================================================= */
  function timeInState(item) {
    const evs = item.events.filter((e) => e.type === "TRANSITION" || e.type === "CREATE").sort((a, b) => a.ts - b.ts);
    const out = {};
    for (let i = 0; i < evs.length; i++) {
      const cur = evs[i].to;
      const end = i + 1 < evs.length ? evs[i + 1].ts : Date.now();
      out[cur] = (out[cur] || 0) + (end - evs[i].ts);
    }
    return out; // state -> ms
  }
  function reworkRate(item) {
    return item.events.filter((e) => e.type === "TRANSITION" && e.kind === "rework").length;
  }
  function leadTime(item) {
    const evs = item.events.slice().sort((a, b) => a.ts - b.ts);
    if (!evs.length) return 0;
    return Date.now() - evs[0].ts;
  }

  /* ---------- Plan vs actual ----------
     PHASE_BUDGET = expected calendar days per phase (org SLA defaults).
     A feature can override any phase via item.plan = { state: days }.
     Actual durations come from the event log (timeInState). */
  const DAY_MS = 24 * 3600e3;
  const PHASE_BUDGET = {
    backlog: 2, in_discovery: 3, defined: 1, technical_design: 2,
    in_development: 5, in_code_review: 1.5, in_qa: 2, staging_uat: 1.5,
    deploying: 0.5, released: 1, monitoring: 7, done: 0,
  };
  function planVsActual(item) {
    const tis = timeInState(item);
    const st = deriveItem(item).state;
    const curSpine = STATES[st] ? STATES[st].spine : null;
    const off = STATES[st] && STATES[st].lane === "off";
    const budget = Object.assign({}, PHASE_BUDGET, item.plan || {});
    // first-entry / last-exit timestamps per phase (for exact date ranges)
    const spanEvs = item.events.filter((e) => e.type === "TRANSITION" || e.type === "CREATE").sort((a, b) => a.ts - b.ts);
    const firstTs = {}, lastEnd = {};
    for (let i = 0; i < spanEvs.length; i++) {
      const cur = spanEvs[i].to;
      const start = spanEvs[i].ts;
      const end = i + 1 < spanEvs.length ? spanEvs[i + 1].ts : Date.now();
      if (firstTs[cur] == null) firstTs[cur] = start;
      lastEnd[cur] = end;
    }
    const order = Object.values(STATES).filter((s) => s.spine != null).sort((a, b) => a.spine - b.spine);
    let expectedTotalMs = 0, expectedToDateMs = 0;
    const phases = order.map((s) => {
      const expectedMs = (budget[s.key] || 0) * DAY_MS;
      const actualMs = tis[s.key] || 0;
      const done = curSpine != null && s.spine < curSpine;
      const current = s.key === st;
      const started = actualMs > 0 || done || current;
      expectedTotalMs += expectedMs;
      if (done || current || (curSpine == null && actualMs > 0)) expectedToDateMs += expectedMs;
      return { key: s.key, label: s.label, lane: s.lane, expectedMs, actualMs, done, current, started,
        startTs: firstTs[s.key] != null ? firstTs[s.key] : null,
        endTs: lastEnd[s.key] != null ? lastEnd[s.key] : null };
    });
    const evs = item.events.slice().sort((a, b) => a.ts - b.ts);
    const createdTs = evs.length ? evs[0].ts : Date.now();
    const endTs = (st === "done" || off) && evs.length ? evs[evs.length - 1].ts : Date.now();
    const actualElapsedMs = endTs - createdTs;
    const targetTs = createdTs + expectedTotalMs;
    let status;
    if (st === "done") status = "shipped";
    else if (off) status = "closed";
    else if (actualElapsedMs > expectedToDateMs * 1.1) status = "behind";
    else if (actualElapsedMs < expectedToDateMs * 0.9) status = "ahead";
    else status = "on_track";
    return { phases, expectedTotalMs, expectedToDateMs, actualElapsedMs, createdTs, targetTs, status, off };
  }

  /* ---------- expose ---------- */
  window.PDLC = {
    ROLES, STATES, TRANSITIONS, GATES, GATE_BEFORE, SHIFT_LEFT, SUBTRACK_FLOW,
    SUBTRACK_LABELS, REJECT_REASONS,
    deriveItem, gateStatus, legalTransitions, applyTransition, ev,
    timeInState, reworkRate, leadTime, label, PHASE_BUDGET, planVsActual,
    spineOrder: Object.values(STATES).filter((s) => s.spine != null).sort((a, b) => a.spine - b.spine),
  };
})();
