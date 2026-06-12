"use client";

import { useEffect, useState } from "react";
import type { Item } from "@/lib/engine";
import { goalProgress } from "@/lib/goals";
import {
  createGoal, deleteGoal, fetchGoals, patchGoal, type GoalInfo,
} from "@/lib/api";

/* Goals (Jira "Goals"): outcomes with member items; progress = the pure
   goalProgress fold over members' spine positions. PM manages membership. */

interface GoalsCardProps {
  items: Item[];
  canManage: boolean;
  onSelectItem: (id: string) => void;
}

export function GoalsCard({ items, canManage, onSelectItem }: GoalsCardProps) {
  const [goals, setGoals] = useState<GoalInfo[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [linkItem, setLinkItem] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    const r = await fetchGoals();
    if (r.ok) setGoals(r.data.goals);
  }
  useEffect(() => { void reload(); }, []);

  const byId = new Map(items.map((i) => [i.id, i]));

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    const r = await p;
    if (!r.ok) { setErr(r.error ?? "Failed."); return; }
    setErr(null);
    void reload();
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Goals <span className="wi-cc">{goals.length}</span></h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>progress = member items on the spine</span></div>
      <div className="card-b">
        {goals.length === 0 && <div className="wi-empty">No goals yet.</div>}
        {goals.map((g) => {
          const members = g.itemIds.map((id) => byId.get(id)).filter(Boolean) as Item[];
          const pct = Math.round(goalProgress(members) * 100);
          return (
            <div key={g.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, fontWeight: 600, textDecoration: g.status === "cancelled" ? "line-through" : undefined }}>{g.title}</span>
                <span className="kpill">{g.status}</span>
                <span className="mono" style={{ color: "var(--text-3)" }}>{g.targetDate ?? "no date"}</span>
                <span className="mono">{pct}%</span>
                {canManage && g.status === "active" &&
                  <button className="act" onClick={() => void run(patchGoal(g.id, { status: "done" }))}>✓ Done</button>}
                {canManage &&
                  <button className="wi-act del" title={`Delete ${g.title}`} onClick={() => void run(deleteGoal(g.id))}>✕</button>}
              </div>
              <div style={{ height: 6, background: "var(--bg-2, #f4f4f6)", borderRadius: 3, margin: "4px 0" }}>
                <div style={{ width: pct + "%", height: "100%", borderRadius: 3, background: pct >= 100 ? "var(--ok)" : "var(--accent)" }} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {members.map((m) => (
                  <span key={m.id} className="board-chip">
                    <button className="mono linklike" onClick={() => onSelectItem(m.id)}
                      style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0 }}>{m.id}</button>
                    {canManage &&
                      <button title={`Remove ${m.id}`} style={{ background: "none", border: 0, cursor: "pointer", padding: "0 0 0 4px" }}
                        onClick={() => void run(patchGoal(g.id, { op: "remove", itemId: m.id }))}>×</button>}
                  </span>
                ))}
                {canManage &&
                  <select value={linkItem} aria-label={`Add item to ${g.title}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLinkItem("");
                      if (v) void run(patchGoal(g.id, { op: "add", itemId: v }));
                    }}>
                    <option value="">＋ add item…</option>
                    {items.filter((i) => !g.itemIds.includes(i.id)).map((i) => <option key={i.id} value={i.id}>{i.id} · {i.title}</option>)}
                  </select>}
              </div>
            </div>
          );
        })}
        {canManage &&
          <div style={{ display: "flex", gap: 6, paddingTop: 8, alignItems: "center" }}>
            <input value={title} placeholder="New goal…" aria-label="Goal title"
              onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
            <input type="date" value={date} aria-label="Target date" onChange={(e) => setDate(e.target.value)} />
            <button className="act" disabled={!title.trim()}
              onClick={() => void run(createGoal(title.trim(), date || null)).then(() => { setTitle(""); setDate(""); })}>
              ＋ Goal
            </button>
          </div>}
        {err && <div className="mono" style={{ color: "var(--danger, #c33)", fontSize: 11, paddingTop: 4 }}>⚠ {err}</div>}
      </div>
    </div>
  );
}
