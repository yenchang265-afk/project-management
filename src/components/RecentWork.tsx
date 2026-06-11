"use client";

import { deriveItem, type Item } from "@/lib/engine";
import { timeAgo } from "@/lib/format";
import { Avatar, WI_STATES } from "./badges";

/* ---------------- RECENT WORK ITEMS ----------------
   Shared panel for the Dashboard / Org / Team views. "Recent" = last activity:
   the newest event referencing a work item, falling back to its parent item's
   latest event when the WI itself has no dedicated events. Pure fold over the
   event log — no schema/timestamp column needed. */

interface RecentRow {
  id: string; title: string; state: keyof typeof WI_STATES; assignee: string;
  itemId: string; itemTitle: string; ts: number;
}

export function recentWork(items: Item[], limit = 6): RecentRow[] {
  const rows: RecentRow[] = [];
  for (const it of items) {
    const itemTs = it.events.reduce((m, e) => Math.max(m, e.ts), 0);
    const wiTs = new Map<string, number>();
    for (const e of it.events)
      if (e.wiId) wiTs.set(e.wiId, Math.max(wiTs.get(e.wiId) ?? 0, e.ts));
    for (const w of deriveItem(it).workItems)
      rows.push({
        id: w.id, title: w.title, state: w.state, assignee: w.assignee || "",
        itemId: it.id, itemTitle: it.title, ts: wiTs.get(w.id) ?? itemTs,
      });
  }
  return rows.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function RecentWork({ items, onOpen, limit = 6, title = "Recent work items" }:
  { items: Item[]; onOpen: (itemId: string, wiId: string) => void; limit?: number; title?: string }) {
  const rows = recentWork(items, limit);
  return (
    <div className="card">
      <div className="card-h"><h3>{title}</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>by last activity</span></div>
      <div className="card-b">
        <div className="recent-work">
          {rows.map((r) => (
            <button key={r.itemId + ":" + r.id} className="recent-row" onClick={() => onOpen(r.itemId, r.id)}
              title={r.itemTitle}>
              <span className="recent-state" style={{ background: WI_STATES[r.state].color }} title={WI_STATES[r.state].label} />
              <span className="recent-ti">{r.title}</span>
              {r.assignee && <span className="recent-asg"><Avatar name={r.assignee} size={18} /></span>}
              <span className="recent-parent mono">{r.itemId}</span>
              <span className="recent-ago">{timeAgo(r.ts)}</span>
            </button>
          ))}
          {!rows.length && <div className="nav-empty">No work items.</div>}
        </div>
      </div>
    </div>
  );
}
