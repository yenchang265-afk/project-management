/* =========================================================================
   COMPONENTS — presentational pieces. Pure-ish; all mutation flows up via
   callbacks. Exported to window at the bottom for app.jsx.
   ========================================================================= */
var { useState, useRef, useEffect, useLayoutEffect } = React;
var P = window.PDLC;

/* ---------------- helpers ---------------- */
function dur(ms) {
  if (ms < 0) ms = 0;
  const m = ms / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + "m";
  const h = m / 60;
  if (h < 24) return (h < 10 ? h.toFixed(1) : Math.round(h)) + "h";
  const d = h / 24;
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + "d";
}
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return Math.round(m) + "m ago";
  const h = m / 60; if (h < 24) return Math.round(h) + "h ago";
  const d = h / 24; if (d < 30) return Math.round(d) + "d ago";
  return new Date(ts).toLocaleDateString();
}
function fullDate(ts) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function initials(name) { return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }
function avatarHue(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function Avatar({ name, size = 26 }) {
  const hue = avatarHue(name);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42,
      background: `oklch(0.62 0.12 ${hue})` }}>{initials(name)}</span>
  );
}
function laneClass(stateKey) { return "lane-" + (P.STATES[stateKey] ? P.STATES[stateKey].lane : "off"); }

/* ---------------- WORK-ITEM TYPES (Jira / Azure DevOps style) ---------------- */
const WI_TYPES = {
  epic:    { label: "Epic",    mono: "E", color: "oklch(0.55 0.16 295)" },
  feature: { label: "Feature", mono: "F", color: "oklch(0.52 0.14 300)" },
  story:   { label: "Story",   mono: "S", color: "oklch(0.58 0.13 150)" },
  task:    { label: "Task",    mono: "T", color: "oklch(0.55 0.13 245)" },
  bug:     { label: "Bug",     mono: "B", color: "oklch(0.585 0.18 25)" },
};
const WI_STATES = {
  todo:        { label: "To Do",       color: "var(--text-3)" },
  in_progress: { label: "In Progress", color: "oklch(0.55 0.13 245)" },
  in_review:   { label: "In Review",   color: "oklch(0.55 0.16 295)" },
  blocked:     { label: "Blocked",     color: "var(--bad)" },
  done:        { label: "Done",        color: "var(--ok)" },
};
function TypeBox({ type, size = 18 }) {
  const t = WI_TYPES[type] || WI_TYPES.task;
  return (
    <span className="wibox mono" title={t.label}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.56), background: t.color }}>{t.mono}</span>
  );
}

/* ---------------- REQUIREMENT DOCS (which spec is signed off at which node) ---------------- */
const REQ_DOCS = [
  { key: "urd", abbr: "URD", label: "User Requirements",        node: "in_discovery",     nodeLabel: "Discovery",       owner: "PM",  color: "oklch(0.56 0.12 200)" },
  { key: "prd", abbr: "PRD", label: "Product Requirements",     node: "defined",          nodeLabel: "Defined",         owner: "PM",  color: "oklch(0.55 0.16 295)", condition: "spec_approved" },
  { key: "erd", abbr: "ERD", label: "Engineering Requirements", node: "technical_design", nodeLabel: "Technical design", owner: "Dev", color: "oklch(0.55 0.13 245)", condition: "design_reviewed" },
];
const DOC_STATUS = {
  approved:  { label: "Approved",  color: "var(--ok)" },
  in_review: { label: "In review", color: "oklch(0.55 0.12 72)" },
  waived:    { label: "Waived",    color: "var(--text-3)" },
  pending:   { label: "Pending",   color: "var(--text-3)" },
};
// derive a doc's sign-off status from the live snapshot (conditions + phase progress)
function docStatus(snap, doc) {
  const curSpine = P.STATES[snap.state] ? P.STATES[snap.state].spine : null;
  const nodeSpine = P.STATES[doc.node].spine;
  if (doc.condition) {
    const c = snap.conditions[doc.condition];
    if (c === "satisfied") return "approved";
    if (c === "waived") return "waived";
    return curSpine != null && curSpine >= nodeSpine ? "in_review" : "pending";
  }
  // URD has no explicit gate condition — it's implicitly signed off once discovery is left
  if (curSpine == null) return "pending";
  if (curSpine > nodeSpine) return "approved";
  if (curSpine === nodeSpine) return "in_review";
  return "pending";
}
function RequirementDocs({ item, snap }) {
  const num = (item.id.split("-")[1]) || "";
  return (
    <div className="card">
      <div className="card-h">
        <h3>Requirement docs</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>spec sign-off by node</span>
      </div>
      <div className="card-b">
        <div className="doc-list">
          {REQ_DOCS.map((d) => {
            const stt = docStatus(snap, d);
            const meta = DOC_STATUS[stt];
            return (
              <div className="doc-row" key={d.key}>
                <span className="doc-abbr mono" style={{ background: d.color }}>{d.abbr}</span>
                <div className="doc-main">
                  <span className="doc-title">{d.label}</span>
                  <span className="doc-sub">{d.abbr}-{num} · <span className="doc-node">{d.nodeLabel}</span> · {d.owner}</span>
                </div>
                <span className="doc-status" style={{ color: meta.color, background: `color-mix(in oklch, ${meta.color} 14%, var(--surface))` }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function StateBadge({ stateKey }) {
  const st = P.STATES[stateKey];
  return (
    <span className={"statebadge " + laneClass(stateKey)}>
      <span className="d" style={{ background: "var(--lc)" }}></span>
      {st ? st.label : stateKey}
    </span>
  );
}

/* ---------------- SPINE ---------------- */
function Spine({ snap }) {
  const cur = snap.state;
  const curSpine = P.STATES[cur] ? P.STATES[cur].spine : undefined;
  const nodes = [];
  P.spineOrder.forEach((st) => {
    // insert a gate diamond BEFORE the state it guards
    if (P.GATE_BEFORE[st.key]) {
      const gk = P.GATE_BEFORE[st.key];
      const gs = P.gateStatus(gk, snap);
      const target = st.spine;
      let vis = "pending";
      if (curSpine != null && curSpine >= target) vis = "open";
      else if (gs.open) vis = "open";
      else if (curSpine === target - 1) vis = "blocked";
      nodes.push(
        <div className={"snode gate-node " + laneClass(st.key)} data-gs={vis} key={"g-" + gk}>
          <div className="bar" data-done={curSpine != null && curSpine >= target}></div>
          <div className="gate-dia"><span className="ic">{vis === "open" ? "✓" : "◆"}</span></div>
          <div className="lb">{P.GATES[gk].label}</div>
        </div>
      );
    }
    const done = curSpine != null && st.spine < curSpine;
    const current = st.key === cur;
    const doc = REQ_DOCS.find((d) => d.node === st.key);
    nodes.push(
      <div className={"snode " + laneClass(st.key)} data-st={current ? "current" : done ? "done" : "future"} key={st.key}>
        <div className="bar" data-done={done || current}></div>
        <div className="mk">{done ? "✓" : st.spine + 1}</div>
        <div className="lb">{st.label}</div>
        {doc && <span className="snode-doc" data-st={docStatus(snap, doc)} title={doc.label + " · " + DOC_STATUS[docStatus(snap, doc)].label}>{doc.abbr}</span>}
      </div>
    );
  });
  return (
    <div className="card spine-card">
      <div className="card-h">
        <h3>Lifecycle</h3>
        {P.STATES[cur] && P.STATES[cur].lane === "off"
          ? <span className="chip" style={{ background: "color-mix(in oklch,var(--bad) 14%,var(--surface))", color: "var(--bad)" }}>
              <span className="d"></span>Off the spine · {P.STATES[cur].label}</span>
          : <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
              {curSpine != null ? `phase ${curSpine + 1} / 12` : ""}</span>}
      </div>
      <div className="spine scroll">{nodes}</div>
    </div>
  );
}

/* ---------------- ACTIONS ---------------- */
const KIND_ICON = { forward: "→", rework: "↺", terminal: "⊘", recovery: "⤺", hotfix: "⚡" };
function Actions({ snap, role, onTransition }) {
  const legal = P.legalTransitions(snap.state);
  const [pop, setPop] = useState(null); // {def, x, y}
  if (!legal.length)
    return <div className="empty-actions">Terminal state — no transitions available.</div>;

  // sort: forward gates first, forward, rework, recovery, terminal
  const order = { forward: 0, hotfix: 1, recovery: 2, rework: 3, terminal: 4 };
  const sorted = legal.slice().sort((a, b) => (order[a.kind] - order[b.kind]) || (b.gate ? 1 : 0));

  function click(def, e) {
    if (def.needsReason) {
      const r = e.currentTarget.getBoundingClientRect();
      setPop({ def, x: r.left, y: r.bottom + 6 });
    } else onTransition(def, null);
  }
  return (
    <>
      <div className="actions">
        {sorted.map((def) => {
          const allowed = def.roles.includes(role);
          const isGate = !!def.gate;
          const cls = "act " + def.kind + (isGate ? " gate" : "") + (isGate && allowed ? " primary" : "");
          return (
            <button key={def.from + def.to} className={cls} disabled={!allowed}
              onClick={(e) => click(def, e)}
              title={allowed ? "" : `Requires ${def.roles.join(" or ")} role`}>
              <span className="ai">{KIND_ICON[def.kind]}</span>
              <span className="txt">
                <span className="t1">{def.label}</span>
                <span className="t2">{P.label(def.from)} → {P.label(def.to)}</span>
              </span>
              {def.kind !== "forward" && <span className="kindtag">{def.kind}</span>}
              {!allowed && <span className="kindtag">{def.roles.join("/")}</span>}
              {isGate && <span className="arrow">◆</span>}
            </button>
          );
        })}
      </div>
      {pop && <ReasonPopover def={pop.def} x={pop.x} y={pop.y}
        onClose={() => setPop(null)}
        onPick={(reason) => { onTransition(pop.def, reason); setPop(null); }} />}
    </>
  );
}

function ReasonPopover({ def, x, y, onClose, onPick }) {
  const [free, setFree] = useState("");
  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="pop" style={{ left: Math.min(x, window.innerWidth - 220), top: y }}>
        <div className="ph">{def.needsReason === "reject" ? "Rejection reason" : "Reason (optional)"}</div>
        {def.needsReason === "reject"
          ? P.REJECT_REASONS.map((r) => (
              <button key={r} onClick={() => onPick(r)}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{r}</span>
              </button>))
          : <>
              <input autoFocus placeholder="why…" value={free}
                onChange={(e) => setFree(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onPick(free || null)} />
              <button className="pgo" onClick={() => onPick(free || null)}>Confirm</button>
            </>}
      </div>
    </>
  );
}

/* ---------------- GATE INSPECTOR ---------------- */
function GateInspector({ gateKey, snap, role, onSatisfy, onWaive, onSignoff, onShiftLeft, showShiftLeft }) {
  const gs = P.gateStatus(gateKey, snap);
  const CSTATE_ICON = { satisfied: "✓", required: "!", waived: "~", not_applicable: "·" };
  return (
    <div className="card">
      <div className="card-h">
        <h3>◆ {gs.gate.label} gate</h3>
        <span className={"gate-status " + (gs.open ? "open" : "blocked")}>
          <span className="chip" style={{ padding: 0 }}><span className="d"></span></span>
          {gs.open ? "Open" : `${gs.blocking.length} blocking`}
        </span>
      </div>
      <div className="card-b">
        {gs.conds.map((c) => {
          const na = c.state === "not_applicable";
          const owns = c.owner === role;
          return (
            <div className="cond" data-na={na} key={c.key}>
              <span className={"cstate " + c.state}>{CSTATE_ICON[c.state]}</span>
              <span className="cmain">
                <span className="clabel">{c.label}</span>
                <span className="ckey">{c.key} · {c.state}{c.track ? ` · track:${c.track}` : ""}</span>
              </span>
              <span className="cowner">{c.owner}</span>
              {c.state === "required" && !c.track &&
                <button className="cbtn sat" disabled={!owns}
                  title={owns ? "" : `Only ${c.owner} can satisfy this`}
                  onClick={() => onSatisfy(c.key)}>Satisfy</button>}
              {c.state === "required" && !c.track &&
                <button className="cbtn" disabled={!owns} onClick={() => onWaive(c.key)}>Waive</button>}
              {c.state === "satisfied" && <span className="ckey" style={{ color: "var(--ok)" }}>done</span>}
              {c.state === "waived" && <span className="ckey">waived</span>}
              {c.track && c.state === "required" &&
                <span className="ckey" style={{ color: "var(--warn)" }}>via sub-track</span>}
              {na && <span className="ckey">n/a</span>}
            </div>
          );
        })}

        {showShiftLeft && gateKey === "ready_for_dev" &&
          <ShiftLeft snap={snap} role={role} onShiftLeft={onShiftLeft} />}

        <div className="signoff">
          {["PM", "Dev"].map((r) => {
            const who = gs.signoff[r];
            const canSign = role === r && !who;
            return (
              <div className="so" data-on={!!who} key={r}>
                <div className="so-h"><span>{r} sign-off</span>{who ? <span style={{ color: "var(--ok)" }}>✓</span> : ""}</div>
                {who
                  ? <div className="so-who"><Avatar name={who} size={20} />{who}</div>
                  : <button className="so-btn" disabled={!canSign}
                      title={canSign ? "" : `Switch to ${r} to sign`}
                      onClick={() => onSignoff(gateKey, r)}>
                      {role === r ? `Sign as ${r}` : `Awaiting ${r}`}</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShiftLeft({ snap, role, onShiftLeft }) {
  return (
    <div className="shiftleft" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
      <div className="card-h" style={{ padding: "0 0 8px", border: "none" }}>
        <h3 style={{ letterSpacing: ".04em" }}>Shift-left risk checklist</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>PM-owned</span>
      </div>
      {P.SHIFT_LEFT.map((r) => {
        const on = snap.activeRisks.has(r.key);
        return (
          <button className="sl-row" key={r.key} style={{ width: "100%", textAlign: "left", background: "none" }}
            disabled={role !== "PM"} onClick={() => onShiftLeft(r.key, !on)}
            title={role !== "PM" ? "Only PM can set risk flags" : ""}>
            <span className="sl-check" data-on={on}>{on ? "✓" : ""}</span>
            <span className="sl-lb">{r.label}</span>
            <span className="sl-eff">→ {r.turnsOn.join(", ")}</span>
          </button>
        );
      })}
      <div className="sl-note">Ticking a risk flips its conditional conditions from <b>not&nbsp;applicable → required</b> for this and the release gate.</div>
    </div>
  );
}

/* ---------------- SUB-TRACKS ---------------- */
function SubTracks({ snap, role, onSubtrack }) {
  const tracks = [
    { key: "security", label: "Security review", owner: "Dev" },
    { key: "compliance", label: "Compliance review", owner: "PM" },
  ];
  const flowKeys = ["pending", "in_review", "changes_requested", "approved"];
  return (
    <div className="card">
      <div className="card-h">
        <h3>Parallel reviews</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>concurrent · feeds release gate</span>
      </div>
      <div className="card-b stack" style={{ gap: 11 }}>
        {tracks.map((t) => {
          const cur = snap.subtracks[t.key];
          const next = P.SUBTRACK_FLOW[cur] || [];
          const owns = t.owner === role;
          const idx = flowKeys.indexOf(cur);
          return (
            <div className="subtrack" key={t.key}>
              <div className="st-h">
                <span className="st-name">
                  <span className="d" style={{ width: 7, height: 7, borderRadius: 2, background: cur === "approved" ? "var(--ok)" : "var(--accent)" }}></span>
                  {t.label}</span>
                <span className="cowner">{t.owner}</span>
              </div>
              <div className="st-flow">
                {flowKeys.filter((k) => k !== "changes_requested" || cur === "changes_requested").map((k, i, arr) => {
                  const ki = flowKeys.indexOf(k);
                  return (
                    <div className={"st-step " + (k === "approved" ? "approved" : "")} key={k}
                      data-on={idx >= ki} data-cur={cur === k} style={{ flex: i === arr.length - 1 ? "0 0 auto" : 1 }}>
                      <span className="sd"></span>
                      {i < arr.length - 1 && <span className="sl"></span>}
                    </div>
                  );
                })}
              </div>
              <div className="st-foot">
                <span className="st-state-lb" style={{ color: cur === "approved" ? "var(--ok)" : cur === "changes_requested" ? "var(--warn)" : "var(--text-2)" }}>
                  {P.SUBTRACK_LABELS[cur]}</span>
                <div className="st-acts">
                  {next.map((nx) => (
                    <button key={nx} disabled={!owns}
                      title={owns ? "" : `Only ${t.owner} can advance this review`}
                      onClick={() => onSubtrack(t.key, nx)}>
                      {nx === "approved" ? "Approve" : nx === "in_review" ? (cur === "pending" ? "Start review" : "Re-review") : "Request changes"}
                    </button>
                  ))}
                  {!next.length && <span className="mono" style={{ fontSize: 11, color: "var(--ok)" }}>✓ approved</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- WORK ITEMS (typed children: story / task / bug) ---------------- */
function WorkItems({ item }) {
  const wi = item.workItems || [];
  // type breakdown, in a stable display order
  const order = ["story", "task", "bug"];
  const counts = {};
  wi.forEach((w) => { counts[w.type] = (counts[w.type] || 0) + 1; });
  const types = order.filter((k) => counts[k]);
  const doneN = wi.filter((w) => w.state === "done").length;
  const pct = wi.length ? Math.round(doneN / wi.length * 100) : 0;
  return (
    <div className="card">
      <div className="card-h">
        <h3>⊞ Work items</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          {wi.length ? `${doneN}/${wi.length} done` : "none yet"}</span>
      </div>
      <div className="card-b">
        {wi.length === 0
          ? <div className="wi-empty">No work items linked to this feature yet.</div>
          : <>
              <div className="witypes">
                {types.map((k) => (
                  <span className="witag" key={k}><TypeBox type={k} size={16} />{counts[k]} {WI_TYPES[k].label}{counts[k] > 1 ? "s" : ""}</span>
                ))}
              </div>
              <div className="wi-prog">
                <div className="bar"><div className="fill" style={{ width: pct + "%" }}></div></div>
                <span className="lb">{pct}%</span>
              </div>
              <div className="wilist">
                {wi.map((w) => {
                  const st = WI_STATES[w.state] || WI_STATES.todo;
                  return (
                    <div className="wirow" key={w.id}>
                      <TypeBox type={w.type} />
                      <span className="wid">{w.id}</span>
                      <span className="wit">{w.title}</span>
                      <Avatar name={w.assignee} size={20} />
                      <span className="wistate" style={{ color: st.color, background: `color-mix(in oklch, ${st.color} 14%, var(--surface))` }}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </>}
      </div>
    </div>
  );
}

/* ---------------- STAKEHOLDERS (PDLC roles) ---------------- */
const SH_COLORS = {
  "Product Manager":      "oklch(0.55 0.16 295)",
  "Engineering Manager":  "oklch(0.5 0.13 250)",
  "Tech Lead":            "oklch(0.55 0.13 210)",
  "Designer":             "oklch(0.56 0.15 330)",
  "QA Lead":              "oklch(0.56 0.12 175)",
  "Security Reviewer":    "oklch(0.6 0.14 55)",
  "Compliance / Legal":   "oklch(0.6 0.12 72)",
};
function Stakeholders({ item, snap }) {
  const list = (item.stakeholders || []).slice();
  // derived: privacy / data-store risk flags pull in a Compliance reviewer
  const risks = snap && snap.activeRisks ? snap.activeRisks : new Set();
  const needCompliance = risks.has("touches_pii") || risks.has("new_data_store");
  if (needCompliance && !list.some((s) => s.role === "Compliance / Legal"))
    list.push({ role: "Compliance / Legal", name: "Grace Bauer", derived: true });
  return (
    <div className="card">
      <div className="card-h">
        <h3>People &amp; stakeholders</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{list.length} roles</span>
      </div>
      <div className="card-b">
        <div className="sh-list">
          {list.map((s) => {
            const c = SH_COLORS[s.role] || "var(--text-3)";
            return (
              <div className="sh-row" key={s.role}>
                <span className="sh-role" style={{ color: c }}>
                  <span className="sh-dot" style={{ background: c }}></span>{s.role}</span>
                <div className="sh-who"><Avatar name={s.name} size={24} /><span>{s.name}</span></div>
                {s.derived && <span className="sh-tag" title="Added automatically because privacy / data-store risk flags are set">auto · risk</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- NAVIGATOR (org → group → team → epic → feature tree) ---------------- */
function navLaneOf(it) { const st = P.deriveItem(it).state; return P.STATES[st].lane; }
function navMatchLane(it, filter) {
  if (filter === "all") return true;
  const lane = navLaneOf(it);
  if (filter === "closed") return lane === "closed" || lane === "off";
  return lane === filter;
}
function Navigator({ groups, items, selId, onSelect, filter, search, collapsed, onToggle }) {
  const q = (search || "").trim().toLowerCase();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const matchText = (it) => !q || it.id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q);
  const matches = items.filter((it) => navMatchLane(it, filter) && matchText(it));
  const matchSet = new Set(matches.map((i) => i.id));
  const shown = new Set(matchSet);
  matches.forEach((it) => { let p = it.parent; while (p && byId[p]) { shown.add(p); p = byId[p].parent; } });
  const isOpen = (k) => !collapsed.has(k);
  const teamShown = (team) => items.filter((it) => it.area === team && shown.has(it.id));
  const teamCount = (team) => items.filter((it) => it.area === team && matchSet.has(it.id)).length;
  const childrenOf = (id) => items.filter((it) => it.parent === id && shown.has(it.id));

  function renderItem(it, depth) {
    const kids = childrenOf(it.id);
    const hasKids = kids.length > 0;
    const ek = "e:" + it.id;
    const open = isOpen(ek);
    const s = P.deriveItem(it);
    return (
      <React.Fragment key={it.id}>
        <button className={"nav-item " + laneClass(s.state)} data-sel={it.id === selId} data-dim={!matchSet.has(it.id)}
          style={{ paddingLeft: depth * 15 + 8 }} onClick={() => onSelect(it.id)}
          title={it.title + " · " + P.STATES[s.state].label}>
          {hasKids
            ? <span className="nav-chev" data-open={open} onClick={(e) => { e.stopPropagation(); onToggle(ek); }}>▸</span>
            : <span className="nav-leaf"></span>}
          <TypeBox type={it.type} size={15} />
          <span className="ni-id">{it.id}</span>
          <span className="ni-ti">{it.title}</span>
          {s.flags.blocked && <span className="ni-flag" title="Blocked">⚑</span>}
          {s.flags.on_hold && <span className="ni-flag hold" title="On hold">⏸</span>}
          <span className="ni-lane" style={{ background: "var(--lc)" }} title={P.STATES[s.state].label}></span>
        </button>
        {hasKids && open && kids.map((k) => renderItem(k, depth + 1))}
      </React.Fragment>
    );
  }

  const visibleGroups = groups.filter((g) => g.teams.some((tm) => teamShown(tm).length));
  if (!visibleGroups.length) return <div className="nav-empty">No items match.</div>;
  return (
    <div className="nav">
      {visibleGroups.map((g) => {
        const gk = "g:" + g.key;
        const gopen = isOpen(gk);
        const teams = g.teams.filter((tm) => teamShown(tm).length);
        const gcount = teams.reduce((n, tm) => n + teamCount(tm), 0);
        return (
          <div className="nav-group" key={g.key}>
            <button className="nav-head" data-lvl="0" onClick={() => onToggle(gk)}>
              <span className="nav-chev" data-open={gopen}>▸</span>
              <span className="nav-glabel">{g.label}</span>
              <span className="nav-count">{gcount}</span>
            </button>
            {gopen && teams.map((tm) => {
              const tk = "t:" + tm;
              const topen = isOpen(tk);
              const tops = teamShown(tm).filter((it) => !it.parent || !shown.has(it.parent));
              return (
                <div className="nav-team" key={tm}>
                  <button className="nav-head" data-lvl="1" style={{ paddingLeft: 22 }} onClick={() => onToggle(tk)}>
                    <span className="nav-chev" data-open={topen}>▸</span>
                    <span className="nav-tlabel">{tm}</span>
                    <span className="nav-count">{teamCount(tm)}</span>
                  </button>
                  {topen && tops.map((it) => renderItem(it, 2))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  dur, timeAgo, fullDate, initials, Avatar, laneClass, StateBadge,
  Spine, Actions, ReasonPopover, GateInspector, ShiftLeft, SubTracks,
  WI_TYPES, WI_STATES, TypeBox, WorkItems, SH_COLORS, Stakeholders,
  REQ_DOCS, DOC_STATUS, docStatus, RequirementDocs, Navigator,
});
