"use client";

import { useEffect, useState } from "react";
import { fetchAudit, type AuditEventInfo } from "@/lib/api";
import { timeAgo } from "@/lib/format";

/* Global audit log (Jira "audit log", PM only): the append-only events table
   read across ALL items, newest first, seq-keyed pagination. Filters are
   exact-match and applied server-side. */

const PAGE = 50;

interface AuditLogProps {
  onSelectItem: (itemId: string) => void;
}

export function AuditLog({ onSelectItem }: AuditLogProps) {
  const [rows, setRows] = useState<AuditEventInfo[]>([]);
  const [fActor, setFActor] = useState("");
  const [fType, setFType] = useState("");
  const [fItem, setFItem] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    const beforeSeq = reset || rows.length === 0 ? undefined : rows[rows.length - 1].seq;
    const r = await fetchAudit({
      actor: fActor.trim() || undefined,
      type: fType.trim().toUpperCase() || undefined,
      item: fItem.trim() || undefined,
      beforeSeq, limit: PAGE,
    });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setDone(r.data.events.length < PAGE);
    setRows(reset ? r.data.events : [...rows, ...r.data.events]);
  }

  // initial page; filter changes re-query from the top (debounced lightly)
  useEffect(() => {
    const t = setTimeout(() => { void load(true); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fActor, fType, fItem]);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Audit log <span className="wi-cc">{rows.length}</span></h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>all items · newest first</span>
      </div>
      <div className="card-b">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8 }}>
          <input value={fActor} placeholder="actor…" aria-label="Filter actor"
            onChange={(e) => setFActor(e.target.value)} style={{ width: 130 }} />
          <input value={fType} placeholder="event type… (e.g. TRANSITION)" aria-label="Filter event type"
            className="mono" onChange={(e) => setFType(e.target.value)} style={{ width: 200 }} />
          <input value={fItem} placeholder="item id…" aria-label="Filter item"
            className="mono" onChange={(e) => setFItem(e.target.value)} style={{ width: 110 }} />
        </div>
        {error && <div className="mono" style={{ color: "var(--danger, #c33)", fontSize: 11, paddingBottom: 6 }}>⚠ {error}</div>}
        {rows.length === 0 && !error && <div className="wi-empty">No events match.</div>}
        {rows.map((e) => (
          <div key={e.seq} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12, alignItems: "center" }}>
            <span className="mono" style={{ color: "var(--text-3)", width: 56, textAlign: "right" }}>#{e.seq}</span>
            <button className="mono linklike" onClick={() => onSelectItem(e.itemId)}
              style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0, width: 96, textAlign: "left" }}>
              {e.itemId}
            </button>
            <span className="mono" style={{ flex: 1 }}>{e.type}</span>
            <span style={{ color: "var(--text-3)" }}>{e.actor} · {e.role}</span>
            <span className="mono" style={{ color: "var(--text-3)", width: 90, textAlign: "right" }}>{timeAgo(e.ts)}</span>
          </div>
        ))}
        {!done && rows.length > 0 &&
          <div style={{ paddingTop: 8 }}>
            <button className="act" onClick={() => void load(false)}>Load more</button>
          </div>}
      </div>
    </div>
  );
}
