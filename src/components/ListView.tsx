"use client";

import { useMemo, useState } from "react";
import {
  deriveItem, legalWiMoves,
  type Item, type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import { parseCql, runCql, wiToCqlRow, type CqlRow } from "@/lib/cql";
import { TypeBox, WI_STATES, WI_TYPES } from "./badges";

/* Flat, spreadsheet-style list of every work item across the visible items
   (Jira "list view"). Filters are AND-combined; state edits go through the
   same flow-checked wiMove command as the board. CSV export is client-side
   over the FILTERED rows. */

interface Row { itemId: string; itemTitle: string; wi: WorkItem; }

interface ListViewProps {
  items: Item[];
  onMove: (itemId: string, wiId: string, to: WiState) => void;
  onOpen: (itemId: string, wiId: string) => void;
}

const COLS = ["id", "title", "item", "type", "state", "assignee", "sprint", "due", "points", "time"] as const;

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function ListView({ items, onMove, onOpen }: ListViewProps) {
  const [q, setQ] = useState("");
  const [fType, setFType] = useState<"" | WiType>("");
  const [fState, setFState] = useState<"" | WiState>("");
  const [fAssignee, setFAssignee] = useState("");
  const [cql, setCql] = useState("");

  const all: Row[] = useMemo(
    () => items.flatMap((it) => deriveItem(it).workItems.map((wi) => ({ itemId: it.id, itemTitle: it.title, wi }))),
    [items],
  );
  const assignees = useMemo(
    () => Array.from(new Set(all.map((r) => r.wi.assignee).filter(Boolean))).sort(),
    [all],
  );

  const basic = all.filter((r) => {
    if (fType && r.wi.type !== fType) return false;
    if (fState && r.wi.state !== fState) return false;
    if (fAssignee && r.wi.assignee !== fAssignee) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${r.wi.id} ${r.wi.title} ${r.itemId} ${r.itemTitle} ${(r.wi.tags || []).join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // CQL pass (AND-combined with the basic filters above): parse on every
  // keystroke, surface the parse error inline, never throw.
  const cqlParsed = cql.trim() ? parseCql(cql) : null;
  const rows = (() => {
    if (!cqlParsed?.ok) return basic; // no query, or a parse error (shown inline) — fall back to the basic filters
    const byKey = new Map(basic.map((r) => [r.itemId + ":" + r.wi.id, r]));
    const cqlRows: CqlRow[] = basic.map((r) => wiToCqlRow(r.itemId, r.wi));
    return runCql(cqlParsed.query, cqlRows)
      .map((cr) => byKey.get(cr.item + ":" + cr.id)!)
      .filter(Boolean);
  })();

  function exportCsv() {
    const head = ["id", "title", "item", "item_title", "type", "state", "assignee", "sprint", "due_date", "story_points", "priority", "time_spent_h", "remaining_h", "tags"];
    const lines = [head.join(",")];
    for (const r of rows) {
      lines.push([
        r.wi.id, r.wi.title, r.itemId, r.itemTitle, r.wi.type, r.wi.state, r.wi.assignee,
        r.wi.sprint ?? "", r.wi.dueDate ?? "", r.wi.storyPoints != null ? String(r.wi.storyPoints) : "",
        r.wi.priority != null ? String(r.wi.priority) : "",
        r.wi.timeSpent != null ? String(r.wi.timeSpent) : "",
        r.wi.remainingEstimate != null ? String(r.wi.remainingEstimate) : "",
        (r.wi.tags || []).join(";"),
      ].map((c) => csvEscape(String(c))).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "work-items.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card" style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "14px 18px" }}>
      <div className="card-h">
        <h3>All work items <span className="wi-cc">{rows.length}/{all.length}</span></h3>
        <button className="act" onClick={exportCsv} disabled={!rows.length}>⤓ CSV</button>
      </div>
      <div className="card-b" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="board-filters" style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8 }}>
          <input value={q} placeholder="Filter by text…" aria-label="Filter text"
            onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <select value={fType} aria-label="Filter type" onChange={(e) => setFType(e.target.value as "" | WiType)}>
            <option value="">All types</option>
            {Object.keys(WI_TYPES).map((t) => <option key={t} value={t}>{WI_TYPES[t as WiType].label}</option>)}
          </select>
          <select value={fState} aria-label="Filter state" onChange={(e) => setFState(e.target.value as "" | WiState)}>
            <option value="">All states</option>
            {Object.keys(WI_STATES).map((s) => <option key={s} value={s}>{WI_STATES[s as WiState].label}</option>)}
          </select>
          <select value={fAssignee} aria-label="Filter assignee" onChange={(e) => setFAssignee(e.target.value)}>
            <option value="">All assignees</option>
            {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ paddingBottom: 8 }}>
          <input value={cql} aria-label="CQL query" className="mono" style={{ width: "100%" }}
            placeholder='CQL: state = todo AND points > 2 ORDER BY points DESC  ·  fields: id title item type state assignee sprint points priority severity phase tag parent due cf.<key>'
            onChange={(e) => setCql(e.target.value)} />
          {cqlParsed && !cqlParsed.ok &&
            <div className="mono" style={{ color: "var(--danger, #c33)", fontSize: 11, paddingTop: 4 }}>⚠ {cqlParsed.error}</div>}
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <table className="list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c} style={{ textAlign: "left", padding: "6px 8px", position: "sticky", top: 0, background: "var(--bg-1)", borderBottom: "1px solid var(--border-2)" }}
                    className="mono">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 &&
                <tr><td colSpan={COLS.length} style={{ padding: 16 }}><div className="wi-empty">No work items match.</div></td></tr>}
              {rows.map((r) => {
                const moves = legalWiMoves(r.wi);
                return (
                  <tr key={r.itemId + ":" + r.wi.id} style={{ borderBottom: "1px solid var(--border-1)" }}>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                      <button className="linklike mono" onClick={() => onOpen(r.itemId, r.wi.id)}
                        style={{ background: "none", border: 0, cursor: "pointer", color: "var(--accent)", padding: 0 }}>
                        {r.wi.id}
                      </button>
                    </td>
                    <td style={{ padding: "4px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.wi.parentWiId && <span className="mono" title={`subtask of ${r.wi.parentWiId}`} style={{ color: "var(--text-3)" }}>↳ </span>}
                      {r.wi.title}
                    </td>
                    <td className="mono" style={{ padding: "4px 8px", whiteSpace: "nowrap", color: "var(--text-3)" }}>{r.itemId}</td>
                    <td style={{ padding: "4px 8px" }}><TypeBox type={r.wi.type} size={14} /></td>
                    <td style={{ padding: "4px 8px" }}>
                      <select value={r.wi.state} aria-label={`State of ${r.wi.id}`}
                        onChange={(e) => onMove(r.itemId, r.wi.id, e.target.value as WiState)}>
                        <option value={r.wi.state}>{WI_STATES[r.wi.state].label}</option>
                        {moves.map((s) => <option key={s} value={s}>→ {WI_STATES[s].label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{r.wi.assignee || <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                    <td className="mono" style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{r.wi.sprint ?? ""}</td>
                    <td className="mono" style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{r.wi.dueDate ?? ""}</td>
                    <td className="mono" style={{ padding: "4px 8px", textAlign: "right" }}>{r.wi.storyPoints ?? ""}</td>
                    <td className="mono" style={{ padding: "4px 8px", whiteSpace: "nowrap", color: "var(--text-3)" }}>
                      {r.wi.timeSpent != null ? `${r.wi.timeSpent}h` : ""}{r.wi.remainingEstimate != null ? ` / ${r.wi.remainingEstimate}h left` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
