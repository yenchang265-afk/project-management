"use client";

import { useMemo, useState } from "react";
import { GATES, STATES, type Item, type Lane } from "@/lib/engine";
import { projectSummary } from "@/lib/summary";
import { timeAgo } from "@/lib/format";
import type { ProjectInfo } from "@/lib/api";

/* Per-project landing (Jira "summary view"): lane spread, the gate each
   in-flight item is heading into, sprint snapshot, recent activity. All
   numbers come from the pure projectSummary fold. */

const LANES: { key: Lane; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "build", label: "Build" },
  { key: "verify", label: "Verify" },
  { key: "release", label: "Release" },
  { key: "closed", label: "Closed" },
  { key: "off", label: "Off-spine" },
];

interface ProjectSummaryViewProps {
  items: Item[];
  projects: ProjectInfo[];
  initialProjectId: string | null;
  onSelectItem: (itemId: string) => void;
}

export function ProjectSummaryView({ items, projects, initialProjectId, onSelectItem }: ProjectSummaryViewProps) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId) || null;

  const scoped = useMemo(() => items.filter((i) => (i.project ?? "") === projectId), [items, projectId]);
  const s = useMemo(() => projectSummary(scoped), [scoped]);
  const laneTotal = LANES.reduce((acc, l) => acc + s.laneSpread[l.key], 0);

  return (
    <div className="card" style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "14px 18px" }}>
      <div className="card-h">
        <h3>Project summary</h3>
        <select value={projectId} aria-label="Project" onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="card-b scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {!project && <div className="wi-empty">No project selected.</div>}
        {project && <>
          <div className="kpis ov-kpis">
            <div className="kpi"><span className="kv">{s.totals.items}</span><span className="kl">Items</span></div>
            <div className="kpi"><span className="kv">{s.totals.workItems}</span><span className="kl">Work items</span></div>
            <div className="kpi"><span className="kv">{s.totals.doneWis}/{s.totals.workItems}</span><span className="kl">WIs done</span></div>
            <div className="kpi"><span className="kv">{s.gates.filter((g) => !g.open).length}</span><span className="kl">Gates blocking</span></div>
          </div>

          <h4 style={{ margin: "14px 0 6px" }}>Lane spread</h4>
          <div className="lanebar" title={`${laneTotal} items`}>
            {LANES.filter((l) => s.laneSpread[l.key] > 0).map((l) => (
              <span key={l.key} className={"lanebar-seg lane-" + l.key}
                style={{ flex: s.laneSpread[l.key] }}
                title={`${l.label}: ${s.laneSpread[l.key]}`} />
            ))}
            {laneTotal === 0 && <span className="lanebar-empty" />}
          </div>
          <div className="rep-legend mono" style={{ paddingTop: 4 }}>
            {LANES.map((l) => <span key={l.key}>{l.label} {s.laneSpread[l.key]}</span>)}
          </div>

          <h4 style={{ margin: "14px 0 6px" }}>Gate status — in-flight items</h4>
          {s.gates.length === 0 && <div className="wi-empty">No item is heading into a gate.</div>}
          {s.gates.map((g) => (
            <div key={g.itemId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
              <button className="mono linklike" onClick={() => onSelectItem(g.itemId)}
                style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0, width: 100, textAlign: "left" }}>
                {g.itemId}
              </button>
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</span>
              <span className="kpill">{STATES[g.state].label}</span>
              <span className="mono" style={{ width: 120 }}>{GATES[g.gate].label}</span>
              <span className="mono" style={{ width: 170, color: g.open ? "var(--ok)" : "var(--danger, #c4453d)" }}>
                {g.open ? "✓ open" : `${g.blocking} blocking · PM ${g.pmSigned ? "✓" : "—"} · Dev ${g.devSigned ? "✓" : "—"}`}
              </span>
            </div>
          ))}

          <h4 style={{ margin: "14px 0 6px" }}>Sprints</h4>
          {s.sprints.length === 0 && <div className="wi-empty">No work items are assigned to a sprint.</div>}
          {s.sprints.map((sp) => (
            <div key={sp.name} style={{ display: "flex", gap: 12, padding: "4px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
              <span className="mono" style={{ width: 120 }}>{sp.name}</span>
              <span>{sp.done}/{sp.total} done</span>
              <span className="mono">{sp.donePoints}/{sp.points} pts</span>
            </div>
          ))}

          <h4 style={{ margin: "14px 0 6px" }}>Recent activity</h4>
          {s.activity.length === 0 && <div className="wi-empty">No events yet.</div>}
          {s.activity.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
              <button className="mono linklike" onClick={() => onSelectItem(a.itemId)}
                style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0, width: 100, textAlign: "left" }}>
                {a.itemId}
              </button>
              <span className="mono" style={{ flex: 1 }}>{a.type}</span>
              <span style={{ color: "var(--text-3)" }}>{a.actor}</span>
              <span className="mono" style={{ color: "var(--text-3)", width: 90, textAlign: "right" }}>{timeAgo(a.ts)}</span>
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}
