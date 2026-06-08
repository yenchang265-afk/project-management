/* =========================================================================
   PANELS — history timeline, analytics, toasts. Derived purely from the log.
   ========================================================================= */
var P = window.PDLC;

/* ---------------- HISTORY (event-sourced log, reverse chrono) ---------------- */
function describeEvent(e) {
  switch (e.type) {
    case "CREATE":
      return { k: "meta", icon: "＋", body: <span className="l1">Item created in <b>{P.label(e.to)}</b></span> };
    case "TRANSITION":
      return { k: e.kind, icon: "→",
        body: <>
          <span className="l1"><b>{transLabel(e)}</b></span>
          <span className="trans">{P.label(e.from)}<span className="arr">→</span>{P.label(e.to)}</span>
        </> };
    case "CONDITION_SATISFY":
      return { k: "meta", icon: "✓", body: <span className="l1">Satisfied condition <span className="mono">{e.condition}</span></span> };
    case "CONDITION_WAIVE":
      return { k: "meta", icon: "~", body: <span className="l1">Waived condition <span className="mono">{e.condition}</span></span> };
    case "GATE_SIGNOFF":
      return { k: "meta", icon: "✓", body: <span className="l1">Signed off <b>{P.GATES[e.gate].label}</b> gate as {e.role}</span> };
    case "SUBTRACK":
      return { k: "meta", icon: "◆", body: <span className="l1"><b style={{ textTransform: "capitalize" }}>{e.track}</b> review → <b>{P.SUBTRACK_LABELS[e.to]}</b></span> };
    case "FLAG_SET":
      return { k: e.value ? "rework" : "meta", icon: "⚑",
        body: <span className="l1">{e.value ? "Flagged" : "Cleared"} <b>{e.flag === "on_hold" ? "on hold" : e.flag}</b></span> };
    case "SHIFT_LEFT_SET":
      return { k: "meta", icon: "⚑", body: <span className="l1">Risk <span className="mono">{e.risk}</span> {e.value ? "flagged" : "cleared"}</span> };
    case "SPAWN_CHILD":
      return { k: "forward", icon: "⎇", body: <span className="l1">Spawned next-iteration child <b>{e.child}</b></span> };
    default:
      return { k: "meta", icon: "·", body: <span className="l1">{e.type}</span> };
  }
}
function transLabel(e) {
  const def = P.TRANSITIONS.find((t) => t.from === e.from && t.to === e.to);
  return def ? def.label : `${P.label(e.from)} → ${P.label(e.to)}`;
}

function History({ item }) {
  const evs = item.events.slice().sort((a, b) => b.ts - a.ts);
  return (
    <div className="card">
      <div className="card-h">
        <h3>History</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{evs.length} events · append-only</span>
      </div>
      <div className="card-b">
        <div className="timeline">
          {evs.map((e) => {
            const d = describeEvent(e);
            return (
              <div className="tl" data-k={d.k} key={e.id}>
                <div className="rail"></div>
                <div className="node">{d.icon}</div>
                <div className="tc">
                  {d.body}
                  <span className="l2">
                    <Avatar name={e.actor} size={15} /> {e.actor}
                    <span className="kpill">{e.role}</span>
                    <span>· {timeAgo(e.ts)}</span>
                  </span>
                  {e.reason && <span className="reason">“{String(e.reason).replace(/_/g, " ")}”</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- PLAN VS ACTUAL (per feature + per phase/node) ---------------- */
const PVA_STATUS = {
  on_track: { label: "On track", cls: "ok" },
  ahead:    { label: "Ahead of plan", cls: "ok" },
  behind:   { label: "Behind plan", cls: "bad" },
  shipped:  { label: "Shipped", cls: "ok" },
  closed:   { label: "Closed early", cls: "muted" },
};
function fmtDays(ms) {
  const d = Math.abs(ms) / 86400e3;
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + "d";
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function PlanVsActual({ item }) {
  const pa = P.planVsActual(item);
  const rows = pa.off ? pa.phases.filter((p) => p.started) : pa.phases;
  const max = Math.max(1, ...rows.map((p) => Math.max(p.expectedMs, p.actualMs)));
  const stt = PVA_STATUS[pa.status];
  const targetDate = new Date(pa.targetTs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="card pva-card">
      <div className="pva-summary">
        <div className="pva-sum">
          <span className="l">Status</span>
          <span className={"pva-chip " + stt.cls}>{stt.label}</span>
        </div>
        <div className="pva-sum">
          <span className="l">Elapsed · actual</span>
          <span className="v">{fmtDays(pa.actualElapsedMs)}</span>
          <span className="s">since {fmtDate(pa.createdTs)}</span>
        </div>
        <div className="pva-sum">
          <span className="l">Plan to date</span>
          <span className="v">{fmtDays(pa.expectedToDateMs)}</span>
          <span className="s">budget through current phase</span>
        </div>
        {pa.off
          ? <div className="pva-sum"><span className="l">Outcome</span><span className="v" style={{ fontSize: 15 }}>Did not ship</span><span className="s">closed off-spine</span></div>
          : <div className="pva-sum"><span className="l">Target ship</span><span className="v" style={{ fontSize: 15 }}>{targetDate}</span><span className="s">{fmtDays(pa.expectedTotalMs)} full-cycle budget</span></div>}
      </div>
      <div className="card-h" style={{ borderTop: "none" }}>
        <h3>Timeline · plan vs actual</h3>
        <span className="pva-legend"><span className="lg-bar"></span>actual<span className="lg-mark"></span>plan</span>
      </div>
      <div className="card-b">
        <div className="pva-rows">
          {rows.map((p) => {
            const expPct = p.expectedMs / max * 100;
            const actPct = Math.min(100, p.actualMs / max * 100);
            const over = p.expectedMs > 0 && p.actualMs > p.expectedMs * 1.05;
            const under = p.expectedMs > 0 && p.actualMs < p.expectedMs * 0.95;
            const variance = p.actualMs - p.expectedMs;
            let vtext, vcls;
            if (!p.started) { vtext = "not started"; vcls = "mute"; }
            else if (p.current && !p.done) { vtext = over ? "+" + fmtDays(variance) + " over" : "in progress"; vcls = over ? "bad" : "cur"; }
            else { vtext = (variance >= 0 ? "+" : "−") + fmtDays(variance) + (over ? " over" : under ? " under" : ""); vcls = over ? "bad" : under ? "ok" : "mute"; }
            const barCls = "pva-actual" + (over ? " over" : p.current && !p.done ? " cur" : "");
            const period = p.started
              ? fmtDate(p.startTs) + " – " + (p.current && !p.done ? "now" : fmtDate(p.endTs))
              : "";
            return (
              <div className={"pva-row " + laneClass(p.key)} key={p.key} data-started={p.started} data-current={p.current}>
                <span className="pl-wrap">
                  <span className="pl">{p.current && <span className="pl-dot"></span>}{p.label}</span>
                  <span className="pl-period">{period}</span>
                </span>
                <span className="pva-track">
                  <span className={barCls} style={{ width: actPct + "%" }}></span>
                  <span className="pva-marker" style={{ left: expPct + "%" }}></span>
                </span>
                <span className="pva-meta">
                  <span className="pva-actd">{p.started ? fmtDays(p.actualMs) : "—"}</span>
                  <span className="pva-plan">plan {fmtDays(p.expectedMs)}</span>
                  <span className={"pva-var " + vcls}>{vtext}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- ANALYTICS ---------------- */
function Analytics({ item }) {
  const rework = P.reworkRate(item);
  const lead = P.leadTime(item);
  return (
    <div className="card">
      <div className="card-h"><h3>Analytics</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>derived from log</span></div>
      <div className="card-b">
        <div className="kpis">
          <div className="kpi"><span className="kv">{dur(lead)}</span><span className="kl">Lead time</span><span className="ku">since created</span></div>
          <div className="kpi"><span className="kv" style={{ color: rework ? "var(--warn)" : "var(--text)" }}>{rework}</span><span className="kl">Rework loops</span><span className="ku">backward moves</span></div>
          <div className="kpi"><span className="kv">{item.events.length}</span><span className="kl">Log events</span><span className="ku">source of truth</span></div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- TOASTS ---------------- */
function Toasts({ toasts, onDismiss }) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => onDismiss(t.id), t.ok ? 2600 : 6000));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className={"toast " + (t.ok ? "ok" : "bad")} key={t.id}>
          <div className="ti">{t.ok ? "✓" : "✕"}</div>
          <div className="tt">
            <div className="ty">{t.ok ? "applied" : t.type}</div>
            <div className="tm">{t.message}</div>
            {t.detail && <div className="td">{t.detail}</div>}
          </div>
          <button className="tx" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { History, Analytics, Toasts, describeEvent, PlanVsActual });
