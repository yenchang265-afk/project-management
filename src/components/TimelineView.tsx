"use client";

import { useMemo } from "react";
import {
  STATES, deriveItem, itemBlockedBy, planVsActual,
  type Item,
} from "@/lib/engine";
import { fmtDate } from "@/lib/format";

/* Read-only roadmap/Gantt (Jira "timeline"): one row per item, planned bar
   from creation to the plan-vs-actual target date, actual progress overlaid.
   All data comes from existing pure folds (planVsActual, deriveItem,
   itemBlockedBy) — this component only projects them onto a time axis. */

const STATUS_COLOR: Record<string, string> = {
  shipped: "var(--ok)",
  closed: "var(--text-3)",
  behind: "var(--danger, #c4453d)",
  ahead: "var(--ok)",
  on_track: "var(--accent)",
};

interface TimelineViewProps {
  items: Item[];
  onSelect: (itemId: string) => void;
}

export function TimelineView({ items, onSelect }: TimelineViewProps) {
  const rows = useMemo(() => items.map((it) => {
    const pva = planVsActual(it);
    const snap = deriveItem(it);
    const doneOrOff = pva.status === "shipped" || pva.off;
    const actualEnd = doneOrOff ? pva.createdTs + pva.actualElapsedMs : Date.now();
    return {
      id: it.id,
      title: it.title,
      state: snap.state,
      start: pva.createdTs,
      target: pva.targetTs,
      actualEnd,
      status: pva.status,
      blockedBy: itemBlockedBy(it, items),
    };
  }), [items]);

  if (!rows.length)
    return <div className="card" style={{ margin: "14px 18px" }}><div className="card-b"><div className="wi-empty">No items to chart.</div></div></div>;

  const min = Math.min(...rows.map((r) => r.start));
  const max = Math.max(...rows.map((r) => Math.max(r.target, r.actualEnd)));
  const span = Math.max(1, max - min);
  const pct = (ts: number) => ((ts - min) / span) * 100;

  return (
    <div className="card" style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "14px 18px" }}>
      <div className="card-h">
        <h3>Timeline <span className="wi-cc">{rows.length}</span></h3>
        <span className="mono rep-sub">{fmtDate(min)} → {fmtDate(max)} · planned bar vs actual fill</span>
      </div>
      <div className="card-b scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border-1)" }}>
            <button className="mono" onClick={() => onSelect(r.id)} title={r.title}
              style={{ width: 110, textAlign: "left", background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.id}
            </button>
            <span style={{ width: 170, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.title}{r.blockedBy.length > 0 && <span title={`blocked by ${r.blockedBy.join(", ")}`}> ⛓</span>}
            </span>
            <span className="kpill" style={{ width: 92, textAlign: "center" }}>{STATES[r.state].label}</span>
            <div style={{ flex: 1, position: "relative", height: 14, background: "var(--bg-2, #f4f4f6)", borderRadius: 3 }}
              title={`${fmtDate(r.start)} → planned ${fmtDate(r.target)}`}>
              {/* planned window */}
              <div style={{
                position: "absolute", left: pct(r.start) + "%", width: Math.max(0.5, pct(r.target) - pct(r.start)) + "%",
                top: 0, bottom: 0, borderRadius: 3, background: "var(--border-2)", opacity: 0.8,
              }} />
              {/* actual progress overlay */}
              <div style={{
                position: "absolute", left: pct(r.start) + "%", width: Math.max(0.5, pct(Math.min(r.actualEnd, max)) - pct(r.start)) + "%",
                top: 3, bottom: 3, borderRadius: 2, background: STATUS_COLOR[r.status] ?? "var(--accent)", opacity: 0.85,
              }} />
              {/* target tick */}
              <div style={{ position: "absolute", left: pct(r.target) + "%", top: -2, bottom: -2, width: 2, background: "var(--text-3)" }} />
            </div>
            <span className="mono" style={{ width: 64, fontSize: 10, color: STATUS_COLOR[r.status], whiteSpace: "nowrap" }}>{r.status.replace("_", " ")}</span>
          </div>
        ))}
        <div className="rep-legend mono" style={{ paddingTop: 8 }}>
          <span><span className="rep-leg-dot" style={{ background: "var(--border-2)" }} />planned window</span>
          <span><span className="rep-leg-dot" style={{ background: "var(--accent)" }} />actual (colored by status)</span>
          <span><span className="rep-leg-dot" style={{ background: "var(--text-3)" }} />target date</span>
          <span>⛓ blocked by an open item link</span>
        </div>
      </div>
    </div>
  );
}
