"use client";

import { useEffect, useState } from "react";
import { fetchDashboardPrefs, saveDashboardPrefs } from "@/lib/api";

/* Dashboard gadgets v1 (Jira "customizable dashboards"): the parent passes a
   registry of kind → render fn; this component owns WHICH kinds show and in
   WHAT order, persisted per user via /api/dashboard. No saved row (or an
   unknown kind) falls back to the default layout / is dropped silently. */

const GADGET_LABELS: Record<string, string> = {
  lane_spread: "Lifecycle spread",
  project_health: "Per-project health",
  cfd: "Cumulative flow",
  goals: "Goals",
  created_resolved: "Created vs resolved",
  recent_work: "Recent work",
  audit_log: "Audit log (admin)",
  workflow: "Workflow viewer",
};

const DEFAULT_ORDER = ["lane_spread", "project_health", "cfd", "goals", "created_resolved", "recent_work", "audit_log", "workflow"];

interface DashboardGadgetsProps {
  isAdmin: boolean;
  render: Record<string, () => React.ReactNode>;
}

export function DashboardGadgets({ isAdmin, render }: DashboardGadgetsProps) {
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let stale = false;
    fetchDashboardPrefs().then((r) => {
      if (!stale && r.ok && r.data.gadgets) setOrder(r.data.gadgets);
    });
    return () => { stale = true; };
  }, []);

  const known = order.filter((k) => k in render);
  const addable = Object.keys(render).filter((k) => !known.includes(k) && (k !== "audit_log" || isAdmin));

  function persist(next: string[]) {
    setOrder(next);
    void saveDashboardPrefs(next);
  }
  function move(kind: string, delta: number) {
    const i = known.indexOf(kind);
    const j = i + delta;
    if (j < 0 || j >= known.length) return;
    const next = [...known];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button className="act" data-on={editing} onClick={() => setEditing(!editing)}>
          {editing ? "✓ Done" : "⚙ Customize"}
        </button>
        {editing && JSON.stringify(known) !== JSON.stringify(DEFAULT_ORDER.filter((k) => k in render)) &&
          <button className="act" onClick={() => persist(DEFAULT_ORDER)}>Reset</button>}
      </div>
      {editing && addable.length > 0 &&
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "4px 0" }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>add gadget:</span>
          {addable.map((k) => (
            <button key={k} className="act" onClick={() => persist([...known, k])}>＋ {GADGET_LABELS[k] ?? k}</button>
          ))}
        </div>}
      {known.map((kind) => {
        const body = render[kind]();
        if (body == null) return null; // e.g. audit_log for non-admins
        return (
          <div key={kind} style={{ position: "relative" }}>
            {editing &&
              <div style={{ position: "absolute", top: 6, right: 8, zIndex: 2, display: "flex", gap: 4 }}>
                <button className="act" title="Move up" onClick={() => move(kind, -1)}>↑</button>
                <button className="act" title="Move down" onClick={() => move(kind, 1)}>↓</button>
                <button className="act" title={`Remove ${GADGET_LABELS[kind] ?? kind}`}
                  onClick={() => persist(known.filter((k) => k !== kind))}>✕</button>
              </div>}
            {body}
          </div>
        );
      })}
      {known.length === 0 && <div className="wi-empty">No gadgets — hit ⚙ Customize to add some.</div>}
    </>
  );
}
