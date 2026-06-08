/* =========================================================================
   SEED DATA — builds items as event logs (the source of truth).
   Timestamps are spread across days so the derived analytics look real.
   ========================================================================= */
(function () {
  "use strict";
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const now = Date.now();
  let n = 0;
  const PM = "Maya Chen", DEV = "Sam Okafor", PM2 = "Devin Roy", DEV2 = "Priya Nair";
  // extended PDLC stakeholder roster (people who don't necessarily act on events)
  const EM = "Marcus Lin", DES = "Lena Petrova", QA = "Ahmed Hassan", SEC = "Nadia Cole";
  const QAROLE = { role: "QA Lead", name: QA };
  const SECROLE = { role: "Security Reviewer", name: SEC };
  // pm = Product Manager, tl = Tech Lead; Eng Manager + Designer are constant for this org
  const roster = (pm, tl, extra) => [
    { role: "Product Manager", name: pm },
    { role: "Engineering Manager", name: EM },
    { role: "Tech Lead", name: tl },
    { role: "Designer", name: DES },
    ...(extra || []),
  ];

  // ageDays ago -> timestamp
  const at = (d) => now - d * DAY;

  function E(itemId, ageDays, type, actor, role, payload) {
    return Object.assign(
      { id: "seed-" + ++n, item: itemId, type, actor, role, ts: at(ageDays) },
      payload || {}
    );
  }

  function item(meta, eventSpecs) {
    return {
      ...meta,
      events: eventSpecs.map((s) => E(meta.id, s[0], s[1], s[2], s[3], s[4])),
    };
  }

  const ITEMS = [];

  /* ---- PAY-412 — at the Ready-for-dev gate, BLOCKED (threat model + dev sign-off). ---- */
  ITEMS.push(item(
    { id: "PAY-412", title: "Apple Pay at checkout", area: "Payments", priority: "High", parent: null,
      type: "feature", stakeholders: roster(PM, DEV, [QAROLE, SECROLE]), workItems: [
        { id: "PAY-418", type: "story", title: "Render Apple Pay button on checkout", state: "todo",        assignee: DEV },
        { id: "PAY-419", type: "task",  title: "Integrate PassKit payment sheet",       state: "in_progress", assignee: DEV },
        { id: "PAY-420", type: "task",  title: "Server: validate merchant session",     state: "in_progress", assignee: DEV2 },
        { id: "PAY-421", type: "bug",   title: "Sandbox token expires after 5 minutes",   state: "blocked",     assignee: DEV2 },
        { id: "PAY-423", type: "task",  title: "Threat-model sign-off document",          state: "todo",        assignee: PM },
      ] },
    [
      [9,   "CREATE",         PM,  "PM",  { to: "backlog" }],
      [8.5, "TRANSITION",     PM,  "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
      [7,   "SHIFT_LEFT_SET", PM,  "PM",  { risk: "touches_pii",  value: true }],
      [7,   "SHIFT_LEFT_SET", PM,  "PM",  { risk: "touches_auth", value: true }],
      [6,   "TRANSITION",     PM,  "PM",  { from: "in_discovery", to: "defined", kind: "forward" }],
      [5.5, "CONDITION_SATISFY", PM, "PM", { condition: "spec_approved" }],
      [4,   "TRANSITION",     DEV, "Dev", { from: "defined", to: "technical_design", kind: "forward" }],
      [3,   "CONDITION_SATISFY", DEV, "Dev", { condition: "estimated" }],
      [2,   "CONDITION_SATISFY", DEV, "Dev", { condition: "design_reviewed" }],
      [1,   "GATE_SIGNOFF",   PM,  "PM",  { gate: "ready_for_dev" }],
    ]
  ));

  /* ---- SEARCH-220 — in QA, one rework loop already (review → dev). ---- */
  ITEMS.push(item(
    { id: "SEARCH-220", title: "Typeahead ranking v2", area: "Search", priority: "Medium", parent: null,
      type: "feature", stakeholders: roster(PM, DEV2, [QAROLE, SECROLE]), workItems: [
        { id: "SEARCH-224", type: "story", title: "Wire new ranking model into typeahead",  state: "done",        assignee: DEV },
        { id: "SEARCH-225", type: "task",  title: "Feature flag + staged rollout",         state: "in_progress", assignee: DEV },
        { id: "SEARCH-226", type: "bug",   title: "Race condition in cache layer",          state: "done",        assignee: DEV2 },
        { id: "SEARCH-227", type: "bug",   title: "Diacritics not matched in query",        state: "in_review",   assignee: DEV2 },
        { id: "SEARCH-228", type: "task",  title: "Latency-budget instrumentation",        state: "done",        assignee: DEV },
      ] },
    [
      [14, "CREATE",      PM,  "PM",  { to: "backlog" }],
      [13, "TRANSITION",  PM,  "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
      [12, "TRANSITION",  PM,  "PM",  { from: "in_discovery", to: "defined", kind: "forward" }],
      [11.5,"CONDITION_SATISFY", PM, "PM", { condition: "spec_approved" }],
      [11, "TRANSITION",  DEV, "Dev", { from: "defined", to: "technical_design", kind: "forward" }],
      [10.5,"CONDITION_SATISFY", DEV, "Dev", { condition: "design_reviewed" }],
      [10.5,"CONDITION_SATISFY", DEV, "Dev", { condition: "estimated" }],
      [10, "GATE_SIGNOFF", PM,  "PM",  { gate: "ready_for_dev" }],
      [10, "GATE_SIGNOFF", DEV, "Dev", { gate: "ready_for_dev" }],
      [10, "TRANSITION",  PM,  "PM",  { from: "technical_design", to: "in_development", kind: "forward" }],
      [8,  "TRANSITION",  DEV, "Dev", { from: "in_development", to: "in_code_review", kind: "forward" }],
      [7,  "TRANSITION",  DEV2,"Dev", { from: "in_code_review", to: "in_development", kind: "rework", reason: "Race condition in cache layer" }],
      [5,  "TRANSITION",  DEV, "Dev", { from: "in_development", to: "in_code_review", kind: "forward" }],
      [4,  "TRANSITION",  DEV2,"Dev", { from: "in_code_review", to: "in_qa", kind: "forward" }],
      [3,  "CONDITION_SATISFY", DEV, "Dev", { condition: "qa_passed" }],
    ]
  ));

  /* ---- NOTIF-88 — at the Release gate; both sub-tracks in review, PM acceptance pending. ---- */
  ITEMS.push(item(
    { id: "NOTIF-88", title: "Weekly email digest opt-in", area: "Growth", priority: "Medium", parent: null,
      type: "feature", stakeholders: roster(PM2, DEV, [QAROLE, SECROLE]), workItems: [
        { id: "NOTIF-90", type: "story", title: "Opt-in toggle in notification settings",  state: "done",      assignee: PM2 },
        { id: "NOTIF-91", type: "task",  title: "Digest aggregation job",                 state: "done",      assignee: DEV },
        { id: "NOTIF-92", type: "task",  title: "Email template + unsubscribe link",      state: "done",      assignee: DEV },
        { id: "NOTIF-93", type: "bug",   title: "Timezone off-by-one in send window",      state: "in_review", assignee: DEV },
        { id: "NOTIF-94", type: "task",  title: "Compliance: CAN-SPAM footer",            state: "in_review", assignee: PM2 },
      ] },
    [
      [20, "CREATE",      PM2, "PM",  { to: "backlog" }],
      [19, "TRANSITION",  PM2, "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
      [18.5,"SHIFT_LEFT_SET", PM2,"PM", { risk: "touches_pii",   value: true }],
      [18.5,"SHIFT_LEFT_SET", PM2,"PM", { risk: "new_data_store",value: true }],
      [18, "TRANSITION",  PM2, "PM",  { from: "in_discovery", to: "defined", kind: "forward" }],
      [17, "CONDITION_SATISFY", PM2,"PM", { condition: "spec_approved" }],
      [16, "TRANSITION",  DEV, "Dev", { from: "defined", to: "technical_design", kind: "forward" }],
      [15.5,"CONDITION_SATISFY", DEV,"Dev", { condition: "design_reviewed" }],
      [15.5,"CONDITION_SATISFY", DEV,"Dev", { condition: "estimated" }],
      [15.5,"CONDITION_SATISFY", DEV,"Dev", { condition: "threat_model" }],
      [15, "GATE_SIGNOFF", PM2, "PM",  { gate: "ready_for_dev" }],
      [15, "GATE_SIGNOFF", DEV, "Dev", { gate: "ready_for_dev" }],
      [15, "TRANSITION",  DEV, "Dev", { from: "technical_design", to: "in_development", kind: "forward" }],
      [12, "TRANSITION",  DEV, "Dev", { from: "in_development", to: "in_code_review", kind: "forward" }],
      [10, "TRANSITION",  DEV, "Dev", { from: "in_code_review", to: "in_qa", kind: "forward" }],
      [9,  "CONDITION_SATISFY", DEV, "Dev", { condition: "qa_passed" }],
      [8,  "TRANSITION",  DEV, "Dev", { from: "in_qa", to: "staging_uat", kind: "forward" }],
      [7,  "SUBTRACK",    DEV, "Dev", { track: "security",   to: "in_review" }],
      [7,  "SUBTRACK",    PM2, "PM",  { track: "compliance", to: "in_review" }],
      [6,  "CONDITION_SATISFY", DEV, "Dev", { condition: "docs_runbook_ready" }],
      [5,  "GATE_SIGNOFF", DEV, "Dev", { gate: "release" }],
    ]
  ));

  /* ---- AUTH-301 — full lifecycle, now Monitoring, spawned an iteration child. ---- */
  ITEMS.push(item(
    { id: "AUTH-301", title: "Passwordless login (magic link)", area: "Identity", priority: "High", parent: null,
      type: "epic", stakeholders: roster(PM, DEV, [QAROLE, SECROLE]), workItems: [
        { id: "AUTH-310", type: "story", title: "Magic-link request + delivery email",     state: "done", assignee: DEV },
        { id: "AUTH-311", type: "task",  title: "Token signing + expiry handling",        state: "done", assignee: DEV },
        { id: "AUTH-312", type: "task",  title: "Rate limiting on link requests",         state: "done", assignee: DEV2 },
        { id: "AUTH-313", type: "bug",   title: "Link reusable within 60s window",        state: "done", assignee: DEV2 },
        { id: "AUTH-314", type: "task",  title: "Security review remediation",           state: "done", assignee: DEV },
      ] },
    [
      [30, "CREATE",      PM,  "PM",  { to: "backlog" }],
      [29, "TRANSITION",  PM,  "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
      [28.5,"SHIFT_LEFT_SET", PM,"PM", { risk: "touches_auth", value: true }],
      [28, "TRANSITION",  PM,  "PM",  { from: "in_discovery", to: "defined", kind: "forward" }],
      [27, "CONDITION_SATISFY", PM, "PM", { condition: "spec_approved" }],
      [26, "TRANSITION",  DEV, "Dev", { from: "defined", to: "technical_design", kind: "forward" }],
      [25.5,"CONDITION_SATISFY", DEV,"Dev", { condition: "design_reviewed" }],
      [25.5,"CONDITION_SATISFY", DEV,"Dev", { condition: "estimated" }],
      [25.5,"CONDITION_SATISFY", DEV,"Dev", { condition: "threat_model" }],
      [25, "GATE_SIGNOFF", PM,  "PM",  { gate: "ready_for_dev" }],
      [25, "GATE_SIGNOFF", DEV, "Dev", { gate: "ready_for_dev" }],
      [25, "TRANSITION",  DEV, "Dev", { from: "technical_design", to: "in_development", kind: "forward" }],
      [22, "TRANSITION",  DEV, "Dev", { from: "in_development", to: "in_code_review", kind: "forward" }],
      [20, "TRANSITION",  DEV, "Dev", { from: "in_code_review", to: "in_qa", kind: "forward" }],
      [18, "CONDITION_SATISFY", DEV, "Dev", { condition: "qa_passed" }],
      [17, "TRANSITION",  DEV, "Dev", { from: "in_qa", to: "staging_uat", kind: "forward" }],
      [16, "SUBTRACK",    DEV, "Dev", { track: "security", to: "in_review" }],
      [15, "SUBTRACK",    DEV2,"Dev", { track: "security", to: "approved" }],
      [15, "CONDITION_SATISFY", PM, "PM", { condition: "pm_acceptance" }],
      [15, "CONDITION_SATISFY", DEV, "Dev", { condition: "docs_runbook_ready" }],
      [15, "GATE_SIGNOFF", PM,  "PM",  { gate: "release" }],
      [15, "GATE_SIGNOFF", DEV, "Dev", { gate: "release" }],
      [15, "TRANSITION",  PM,  "PM",  { from: "staging_uat", to: "deploying", kind: "forward" }],
      [14, "TRANSITION",  DEV, "Dev", { from: "deploying", to: "released", kind: "forward" }],
      [13, "TRANSITION",  DEV, "Dev", { from: "released", to: "monitoring", kind: "forward" }],
      [3,  "SPAWN_CHILD", PM,  "PM",  { child: "AUTH-356" }],
    ]
  ));

  /* ---- AUTH-356 — the linked child (next iteration of AUTH-301). ---- */
  ITEMS.push(item(
    { id: "AUTH-356", title: "Passwordless login — passkeys (iteration 2)", area: "Identity", priority: "Medium", parent: "AUTH-301",
      type: "feature", stakeholders: roster(PM, DEV), workItems: [
        { id: "AUTH-360", type: "story", title: "Passkey registration flow",   state: "todo", assignee: PM },
        { id: "AUTH-361", type: "task",  title: "WebAuthn server support",      state: "todo", assignee: DEV },
      ] },
    [
      [3, "CREATE",     PM,  "PM",  { to: "backlog" }],
      [2, "TRANSITION", PM,  "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
    ]
  ));

  /* ---- ONB-140 — in development, BLOCKED flag set (orthogonal to state). ---- */
  ITEMS.push(item(
    { id: "ONB-140", title: "Onboarding checklist redesign", area: "Onboarding", priority: "Low", parent: null,
      type: "feature", stakeholders: roster(PM2, DEV2, [QAROLE]), workItems: [
        { id: "ONB-145", type: "story", title: "Redesign checklist component",     state: "in_progress", assignee: DEV2 },
        { id: "ONB-146", type: "task",  title: "Migrate to design-system tokens (DS-91)", state: "blocked", assignee: DEV2 },
        { id: "ONB-147", type: "task",  title: "Persist checklist progress",      state: "todo",        assignee: DEV2 },
      ] },
    [
      [12, "CREATE",      PM2, "PM",  { to: "backlog" }],
      [11, "TRANSITION",  PM2, "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
      [10, "TRANSITION",  PM2, "PM",  { from: "in_discovery", to: "defined", kind: "forward" }],
      [9.5,"CONDITION_SATISFY", PM2,"PM", { condition: "spec_approved" }],
      [9,  "TRANSITION",  DEV2,"Dev", { from: "defined", to: "technical_design", kind: "forward" }],
      [8.5,"CONDITION_SATISFY", DEV2,"Dev", { condition: "design_reviewed" }],
      [8.5,"CONDITION_SATISFY", DEV2,"Dev", { condition: "estimated" }],
      [8,  "GATE_SIGNOFF", PM2, "PM",  { gate: "ready_for_dev" }],
      [8,  "GATE_SIGNOFF", DEV2,"Dev", { gate: "ready_for_dev" }],
      [8,  "TRANSITION",  DEV2,"Dev", { from: "technical_design", to: "in_development", kind: "forward" }],
      [6,  "FLAG_SET",    DEV2,"Dev", { flag: "blocked", value: true, reason: "Waiting on design-token migration (DS-91)" }],
    ]
  ));

  /* ---- BILLING-77 — rejected terminal (out_of_scope). ---- */
  ITEMS.push(item(
    { id: "BILLING-77", title: "Legacy invoice CSV export", area: "Billing", priority: "Low", parent: null,
      type: "feature", stakeholders: roster(PM, DEV), workItems: [] },
    [
      [8, "CREATE",     PM,  "PM",  { to: "backlog" }],
      [7, "TRANSITION", PM,  "PM",  { from: "backlog", to: "in_discovery", kind: "forward" }],
      [5, "TRANSITION", PM,  "PM",  { from: "in_discovery", to: "rejected", kind: "terminal", reason: "out_of_scope" }],
    ]
  ));

  window.PDLC_SEED = {
    ITEMS,
    people: { PM, DEV, PM2, DEV2 },
    org: { key: "acme", name: "Acme Corp", sub: "Engineering" },
    orgs: ["Acme Corp", "Globex", "Initech"],
    // portfolio groups → teams (teams map to item.area)
    groups: [
      { key: "commerce", label: "Commerce",          teams: ["Payments", "Billing"] },
      { key: "identity", label: "Identity & Access", teams: ["Identity"] },
      { key: "growth",   label: "Discovery & Growth", teams: ["Search", "Growth"] },
      { key: "platform", label: "Core Platform",     teams: ["Onboarding"] },
    ],
  };
})();
