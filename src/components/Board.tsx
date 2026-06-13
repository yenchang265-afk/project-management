"use client";

import { useEffect, useMemo, useState } from "react";
import {
  WI_PHASES_ALL, WI_PHASE_LABELS, WI_TYPES_ALL, deriveItem, wiBlockedBy,
  type Item, type WiPhase, type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import { parseCql, runCql, wiToCqlRow, type CqlQuery } from "@/lib/cql";
import { fetchFilters, type SavedFilterInfo } from "@/lib/api";
import { wipLevel, type WipLimits } from "@/lib/wip";
import { Avatar, TypeBox, WI_STATES } from "./badges";

const COLUMNS: WiState[] = ["todo", "in_progress", "in_review", "blocked", "done"];
const WIP_STORE_KEY = "cadence.board.wipLimits";

interface BoardProps {
  items: Item[];
  onMove: (itemId: string, wiId: string, to: WiState) => void;
  onOpen: (itemId: string, wiId: string) => void;
}

interface Row {
  item: Item;
  wis: (WorkItem & { blockedBy: string[] })[];
}

/* ---------------- BOARD — cross-feature kanban; columns = WI states,
   swimlanes = features. Drag-drop calls the flow-checked engine transition;
   illegal moves surface as rejection toasts from the parent. ---------------- */
export function Board({ items, onMove, onOpen }: BoardProps) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<WiType | "all">("all");
  const [phase, setPhase] = useState<WiPhase | "all" | "none">("all");
  const [assignee, setAssignee] = useState("all");
  const [sprint, setSprint] = useState("all");
  const [drag, setDrag] = useState<{ itemId: string; wiId: string } | null>(null);
  // quick filters: saved CQL filters rendered as toggle pills (Jira's board quick filters)
  const [savedFilters, setSavedFilters] = useState<SavedFilterInfo[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set());
  // WIP limits: per-column caps, client-persisted (UI config, never block a move)
  const [wipLimits, setWipLimits] = useState<WipLimits>({});
  const [editWip, setEditWip] = useState(false);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" && window.localStorage.getItem(WIP_STORE_KEY);
      if (raw) setWipLimits(JSON.parse(raw) as WipLimits);
    } catch { /* ignore corrupt/unavailable storage */ }
  }, []);

  function setColumnLimit(col: WiState, value: number) {
    setWipLimits((prev) => {
      const next = { ...prev };
      if (value > 0) next[col] = value; else delete next[col];
      try { window.localStorage.setItem(WIP_STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  useEffect(() => {
    let stale = false;
    fetchFilters().then((r) => { if (!stale && r.ok) setSavedFilters(r.data.filters); });
    return () => { stale = true; };
  }, []);

  function toggleFilter(id: string) {
    setActiveFilters((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // active pills AND-combine: a card must satisfy EVERY toggled filter
  const activeQueries: CqlQuery[] = useMemo(() =>
    savedFilters
      .filter((f) => activeFilters.has(f.id))
      .map((f) => parseCql(f.cql))
      .flatMap((p) => (p.ok ? [p.query] : [])), // unparseable saved rows are skipped
    [savedFilters, activeFilters]);

  // snapshots once per render; board reads every item's work items
  const snaps = useMemo(() => items.map((it) => ({ item: it, snap: deriveItem(it) })), [items]);

  const people = useMemo(() => Array.from(new Set(
    snaps.flatMap(({ snap }) => snap.workItems.map((w) => w.assignee)).filter(Boolean)
  )).sort(), [snaps]);
  const sprints = useMemo(() => Array.from(new Set(
    snaps.flatMap(({ snap }) => snap.workItems.map((w) => w.sprint)).filter(Boolean) as string[]
  )).sort(), [snaps]);

  const needle = q.trim().toLowerCase();
  function matches(w: WorkItem): boolean {
    if (type !== "all" && w.type !== type) return false;
    if (phase === "none" ? w.phase != null : phase !== "all" && w.phase !== phase) return false;
    if (assignee !== "all" && w.assignee !== assignee) return false;
    if (sprint !== "all" && w.sprint !== sprint) return false;
    if (needle && !(w.title.toLowerCase().includes(needle) || w.id.toLowerCase().includes(needle)
      || (w.tags || []).some((t) => t.toLowerCase().includes(needle)))) return false;
    return true;
  }

  const rows: Row[] = snaps
    .map(({ item, snap }) => ({
      item,
      wis: snap.workItems
        .filter(matches)
        .filter((w) => activeQueries.every((query) => runCql(query, [wiToCqlRow(item.id, w)]).length === 1))
        .map((w) => ({ ...w, blockedBy: wiBlockedBy(snap, w.id) })),
    }))
    .filter((r) => r.wis.length > 0);

  const total = rows.reduce((n, r) => n + r.wis.length, 0);

  function drop(e: React.DragEvent, to: WiState) {
    e.preventDefault();
    if (!drag) return;
    const cur = rows.flatMap((r) => r.wis).find((w) => w.id === drag.wiId);
    if (cur && cur.state !== to) onMove(drag.itemId, drag.wiId, to);
    setDrag(null);
  }

  return (
    <div className="board">
      <div className="board-filters">
        <div className="nav-search board-search">
          <span className="ns-ic">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work items…" />
          {q && <button className="ns-x" onClick={() => setQ("")}>×</button>}
        </div>
        <select className="wi-sel" value={type} onChange={(e) => setType(e.target.value as WiType | "all")} title="Type">
          <option value="all">All types</option>
          {WI_TYPES_ALL.filter((t) => t !== "epic" && t !== "feature").map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="wi-sel" value={phase} onChange={(e) => setPhase(e.target.value as WiPhase | "all" | "none")} title="Phase">
          <option value="all">All phases</option>
          {WI_PHASES_ALL.map((p) => <option key={p} value={p}>{WI_PHASE_LABELS[p]}</option>)}
          <option value="none">No phase</option>
        </select>
        <select className="wi-sel" value={assignee} onChange={(e) => setAssignee(e.target.value)} title="Assignee">
          <option value="all">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="wi-sel" value={sprint} onChange={(e) => setSprint(e.target.value)} title="Sprint">
          <option value="all">All sprints</option>
          {sprints.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="mono board-count">{total} item{total === 1 ? "" : "s"}</span>
      </div>

      {savedFilters.length > 0 &&
        <div className="board-filters" style={{ paddingTop: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)", alignSelf: "center" }}>quick filters:</span>
          {savedFilters.map((f) => (
            <button key={f.id} className="act" data-on={activeFilters.has(f.id)}
              title={f.cql} onClick={() => toggleFilter(f.id)}
              style={activeFilters.has(f.id) ? { background: "var(--accent)", color: "var(--bg-0, #fff)" } : undefined}>
              {f.name}
            </button>
          ))}
          {activeFilters.size > 0 &&
            <button className="act" onClick={() => setActiveFilters(new Set())}>× clear</button>}
        </div>}

      <div className="board-grid-head">
        <div className="board-lane-label">
          <button className="act" style={{ fontSize: 10 }} data-on={editWip}
            title="Set per-column WIP limits" onClick={() => setEditWip((e) => !e)}>WIP</button>
        </div>
        {COLUMNS.map((c) => {
          const count = rows.reduce((n, r) => n + r.wis.filter((w) => w.state === c).length, 0);
          const limit = wipLimits[c];
          const level = wipLevel(count, limit);
          return (
            <div key={c} className="board-col-head" style={{ color: WI_STATES[c].color }} data-wip={level}>
              {WI_STATES[c].label}
              <span className="mono board-col-n"
                style={level === "over" ? { color: "var(--danger, #d44)", fontWeight: 700 }
                  : level === "at" ? { color: "var(--warn)" } : undefined}
                title={limit ? `${count} of ${limit} (WIP limit)` : undefined}>
                {count}{limit ? ` / ${limit}` : ""}
              </span>
              {editWip &&
                <input type="number" min={0} className="wi-sel" style={{ width: 52, marginLeft: 6, padding: "1px 3px" }}
                  value={limit ?? ""} placeholder="∞"
                  onChange={(e) => setColumnLimit(c, Math.max(0, parseInt(e.target.value, 10) || 0))}
                  title="WIP limit (0 = none)" />}
            </div>
          );
        })}
      </div>

      <div className="board-rows scroll">
        {rows.length === 0 && <div className="wi-empty board-empty">No work items match the current filters.</div>}
        {rows.map((r) => (
          <div className="board-row" key={r.item.id}>
            <div className="board-lane-label">
              <TypeBox type={r.item.type} size={16} />
              <div>
                <div className="board-lane-id mono">{r.item.id}</div>
                <div className="board-lane-title">{r.item.title}</div>
              </div>
            </div>
            {COLUMNS.map((c) => (
              <div key={c} className="board-cell" data-state={c}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, c)}>
                {r.wis.filter((w) => w.state === c).map((w) => (
                  <div key={w.id} className="board-card" draggable
                    onDragStart={() => setDrag({ itemId: r.item.id, wiId: w.id })}
                    onDragEnd={() => setDrag(null)}
                    onClick={() => onOpen(r.item.id, w.id)}>
                    <div className="board-card-h">
                      <TypeBox type={w.type} size={14} />
                      <span className="mono board-card-id">{w.id}</span>
                      {w.blockedBy.length > 0 && w.state !== "done" &&
                        <span className="board-card-blocked" title={`Blocked by ${w.blockedBy.join(", ")}`}>⛓</span>}
                      {w.priority != null && <span className="board-card-prio mono">P{w.priority}</span>}
                    </div>
                    <div className="board-card-title">{w.title}</div>
                    <div className="board-card-f">
                      {w.phase && <span className="board-chip">{WI_PHASE_LABELS[w.phase]}</span>}
                      {w.sprint && <span className="board-chip sprint">{w.sprint}</span>}
                      {w.storyPoints != null && <span className="board-chip pts mono">{w.storyPoints}</span>}
                      <span className="spacer"></span>
                      {w.assignee && <Avatar name={w.assignee} size={18} />}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
