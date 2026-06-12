"use client";

import { useEffect, useMemo, useState } from "react";
import { GATES, STATES, deriveItem, type Item, type Lane } from "@/lib/engine";
import { projectSummary } from "@/lib/summary";
import { timeAgo } from "@/lib/format";
import {
  assignItemVersion, createVersion, deleteVersion, fetchVersions, updateVersion,
  type ProjectInfo, type VersionInfo,
} from "@/lib/api";

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
  canManage: boolean;
  onSelectItem: (itemId: string) => void;
}

export function ProjectSummaryView({ items, projects, initialProjectId, canManage, onSelectItem }: ProjectSummaryViewProps) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId) || null;

  const scoped = useMemo(() => items.filter((i) => (i.project ?? "") === projectId), [items, projectId]);
  const s = useMemo(() => projectSummary(scoped), [scoped]);
  const laneTotal = LANES.reduce((acc, l) => acc + s.laneSpread[l.key], 0);

  // ----- versions / releases (metadata — fetched here, not part of App state) -----
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [verName, setVerName] = useState("");
  const [verDate, setVerDate] = useState("");
  const [verErr, setVerErr] = useState<string | null>(null);
  // items.fix_version updates don't flow through App's event-driven state, so
  // remember local assignments until the next full item reload
  const [verOverride, setVerOverride] = useState<Record<string, string | null>>({});

  async function reloadVersions(pid: string) {
    if (!pid) { setVersions([]); return; }
    const r = await fetchVersions(pid);
    if (r.ok) setVersions(r.data.versions);
  }

  useEffect(() => {
    setVerOverride({});
    setVerErr(null);
    void reloadVersions(projectId);
  }, [projectId]);

  const fixVersionOf = (it: Item): string | null =>
    it.id in verOverride ? verOverride[it.id] : it.fixVersion ?? null;

  const releasedSpine = STATES.released.spine!;
  function versionProgress(verId: string): { done: number; total: number } {
    const members = scoped.filter((it) => fixVersionOf(it) === verId);
    const done = members.filter((it) => {
      const sp = STATES[deriveItem(it).state].spine;
      return sp != null && sp >= releasedSpine;
    }).length;
    return { done, total: members.length };
  }

  async function onCreateVersion() {
    const r = await createVersion(projectId, verName.trim(), verDate || null);
    if (!r.ok) { setVerErr(r.error); return; }
    setVerErr(null);
    setVerName(""); setVerDate("");
    void reloadVersions(projectId);
  }

  async function onVersionState(id: string, state: "released" | "archived" | "unreleased") {
    const r = await updateVersion(id, { state });
    if (!r.ok) { setVerErr(r.error); return; }
    setVerErr(null);
    void reloadVersions(projectId);
  }

  async function onDeleteVersion(id: string) {
    const r = await deleteVersion(id);
    if (!r.ok) { setVerErr(r.error); return; }
    setVerErr(null);
    setVerOverride((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== id)));
    void reloadVersions(projectId);
  }

  async function onAssign(itemId: string, versionId: string | null) {
    const r = await assignItemVersion(itemId, versionId);
    if (!r.ok) { setVerErr(r.error); return; }
    setVerErr(null);
    setVerOverride((o) => ({ ...o, [itemId]: versionId }));
    void reloadVersions(projectId);
  }

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

          <h4 style={{ margin: "14px 0 6px" }}>Releases</h4>
          {versions.length === 0 && <div className="wi-empty">No versions yet.</div>}
          {versions.map((v) => {
            const prog = versionProgress(v.id);
            return (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
                <span className="mono" style={{ width: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</span>
                <span className="kpill">{v.state}</span>
                <span className="mono" style={{ color: "var(--text-3)", width: 84 }}>{v.releaseDate ?? "no date"}</span>
                <span className="mono" style={{ flex: 1 }}>{prog.done}/{prog.total} items released</span>
                {canManage && v.state === "unreleased" &&
                  <button className="act" title="Release — every member item must be at or past Released on the spine"
                    onClick={() => void onVersionState(v.id, "released")}>⛴ Release</button>}
                {canManage && v.state === "released" &&
                  <button className="act" onClick={() => void onVersionState(v.id, "archived")}>Archive</button>}
                {canManage &&
                  <button className="wi-act del" title={`Delete ${v.name}`} onClick={() => void onDeleteVersion(v.id)}>✕</button>}
              </div>
            );
          })}
          {canManage &&
            <div style={{ display: "flex", gap: 6, paddingTop: 6, alignItems: "center" }}>
              <input value={verName} placeholder="New version… (e.g. 2.1.0)" aria-label="Version name"
                onChange={(e) => setVerName(e.target.value)} style={{ width: 170 }} />
              <input type="date" value={verDate} aria-label="Release date" onChange={(e) => setVerDate(e.target.value)} />
              <button className="act" disabled={!verName.trim()} onClick={() => void onCreateVersion()}>＋ Version</button>
            </div>}
          {verErr && <div className="mono" style={{ color: "var(--danger, #c33)", fontSize: 11, paddingTop: 4 }}>⚠ {verErr}</div>}
          {versions.length > 0 &&
            <div style={{ paddingTop: 8 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", paddingBottom: 2 }}>fix version per item</div>
              {scoped.map((it) => (
                <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0", fontSize: 12 }}>
                  <button className="mono linklike" onClick={() => onSelectItem(it.id)}
                    style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0, width: 100, textAlign: "left" }}>
                    {it.id}
                  </button>
                  <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
                  <select value={fixVersionOf(it) ?? ""} aria-label={`Fix version of ${it.id}`} disabled={!canManage}
                    onChange={(e) => void onAssign(it.id, e.target.value || null)}>
                    <option value="">—</option>
                    {versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              ))}
            </div>}

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
