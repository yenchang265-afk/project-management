"use client";

import { planVsActual, type Item } from "@/lib/engine";
import { fmtDate, fmtDays } from "@/lib/format";
import { laneClass } from "./badges";

/* ---------------- PLAN VS ACTUAL (per feature + per phase/node) ---------------- */
const PVA_STATUS: Record<string, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "ok" },
  ahead:    { label: "Ahead of plan", cls: "ok" },
  behind:   { label: "Behind plan", cls: "bad" },
  shipped:  { label: "Shipped", cls: "ok" },
  closed:   { label: "Closed early", cls: "muted" },
};

export function PlanVsActual({ item }: { item: Item }) {
  const pa = planVsActual(item);
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
            const expPct = (p.expectedMs / max) * 100;
            const actPct = Math.min(100, (p.actualMs / max) * 100);
            const over = p.expectedMs > 0 && p.actualMs > p.expectedMs * 1.05;
            const under = p.expectedMs > 0 && p.actualMs < p.expectedMs * 0.95;
            const variance = p.actualMs - p.expectedMs;
            let vtext: string, vcls: string;
            if (!p.started) { vtext = "not started"; vcls = "mute"; }
            else if (p.current && !p.done) { vtext = over ? "+" + fmtDays(variance) + " over" : "in progress"; vcls = over ? "bad" : "cur"; }
            else { vtext = (variance >= 0 ? "+" : "−") + fmtDays(variance) + (over ? " over" : under ? " under" : ""); vcls = over ? "bad" : under ? "ok" : "mute"; }
            const barCls = "pva-actual" + (over ? " over" : p.current && !p.done ? " cur" : "");
            const period = p.started && p.startTs != null
              ? fmtDate(p.startTs) + " – " + (p.current && !p.done ? "now" : p.endTs != null ? fmtDate(p.endTs) : "")
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
