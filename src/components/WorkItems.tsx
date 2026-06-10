"use client";

import { useState } from "react";
import { legalWiMoves, wiBlockedBy, type Item, type Role, type Snapshot, type WiState, type WiType, type WorkItem } from "@/lib/engine";
import { Avatar, TypeBox, WI_STATES, WI_TYPES } from "./badges";

const WI_TYPE_OPTS: WiType[] = ["story", "task", "bug"];
const WI_STATE_OPTS: WiState[] = ["todo", "in_progress", "in_review", "blocked", "done"];

type Draft = { type: WiType; title: string; assignee: string; state: WiState };
const EMPTY_DRAFT: Draft = { type: "task", title: "", assignee: "", state: "todo" };

interface WorkItemsProps {
  item: Item;
  snap: Snapshot;
  role: Role;
  onCreate: (draft: Draft) => void;
  onUpdate: (wiId: string, patch: Partial<WorkItem>) => void;
  onDelete: (wiId: string) => void;
  onOpen: (wiId: string) => void;
  onMove: (wiId: string, to: WiState) => void;
  onReorder: (wiId: string, toIndex: number) => void;
}

/* ---------------- WORK ITEMS — inline CRUD (story / task / bug) ---------------- */
export function WorkItems({ item, snap, onCreate, onUpdate, onDelete, onOpen, onMove, onReorder }: WorkItemsProps) {
  const wi = snap.workItems;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);

  // assignee options: stakeholders ∪ existing assignees (unique, non-empty)
  const people = Array.from(new Set([
    ...item.stakeholders.map((s) => s.name),
    ...wi.map((w) => w.assignee),
  ].filter(Boolean)));

  // type breakdown + progress (derived from the snapshot)
  const order: WiType[] = ["story", "task", "bug"];
  const counts: Partial<Record<WiType, number>> = {};
  wi.forEach((w) => { counts[w.type] = (counts[w.type] || 0) + 1; });
  const types = order.filter((k) => counts[k]);
  const doneN = wi.filter((w) => w.state === "done").length;
  const pct = wi.length ? Math.round((doneN / wi.length) * 100) : 0;

  function startEdit(w: WorkItem) {
    setAdding(false);
    setEditingId(w.id);
    setDraft({ type: w.type, title: w.title, assignee: w.assignee, state: w.state });
  }
  function saveEdit(id: string) {
    if (!draft.title.trim()) return;
    const w = wi.find((x) => x.id === id);
    if (w) {
      // send only the fields that changed; skip the write entirely on a no-op save
      const patch: Partial<WorkItem> = {};
      if (draft.type !== w.type) patch.type = draft.type;
      if (draft.title.trim() !== w.title) patch.title = draft.title.trim();
      if (draft.assignee !== w.assignee) patch.assignee = draft.assignee;
      if (draft.state !== w.state) patch.state = draft.state;
      if (Object.keys(patch).length) onUpdate(id, patch);
    }
    setEditingId(null);
  }
  function openAdd() {
    setEditingId(null);
    setNewDraft({ ...EMPTY_DRAFT, assignee: people[0] || "" });
    setAdding(true);
  }
  function submitNew() {
    if (!newDraft.title.trim()) return;
    onCreate({ ...newDraft, title: newDraft.title.trim() });
    setNewDraft(EMPTY_DRAFT);
    setAdding(false);
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>⊞ Work items</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          {wi.length ? `${doneN}/${wi.length} done` : "none yet"}</span>
      </div>
      <div className="card-b">
        {wi.length === 0
          ? <div className="wi-empty">No work items linked to this feature yet.</div>
          : <>
              <div className="witypes">
                {types.map((k) => (
                  <span className="witag" key={k}><TypeBox type={k} size={16} />{counts[k]} {WI_TYPES[k].label}{counts[k]! > 1 ? "s" : ""}</span>
                ))}
              </div>
              <div className="wi-prog">
                <div className="bar"><div className="fill" style={{ width: pct + "%" }}></div></div>
                <span className="lb">{pct}%</span>
              </div>
              <div className="wilist">
                {wi.map((w, i) => {
                  const editing = editingId === w.id;
                  const dstate = editing ? draft.state : w.state; // shown state (draft while editing)
                  const st = WI_STATES[dstate] || WI_STATES.todo;
                  const blockers = wiBlockedBy(snap, w.id);
                  return (
                    <div className="wirow" key={w.id}>
                      <span className="wi-rank">
                        <button className="wi-rank-btn" title="Move up" disabled={i === 0} onClick={() => onReorder(w.id, i - 1)}>▲</button>
                        <button className="wi-rank-btn" title="Move down" disabled={i === wi.length - 1} onClick={() => onReorder(w.id, i + 1)}>▼</button>
                      </span>
                      <TypeBox type={editing ? draft.type : w.type} />
                      <span className="wid">{w.id}</span>
                      {blockers.length > 0 && w.state !== "done" &&
                        <span className="wi-blocked" title={`Blocked by ${blockers.join(", ")}`}>⛓</span>}
                      {editing
                        ? <input className="wi-inp" value={draft.title} autoFocus
                            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(w.id); if (e.key === "Escape") setEditingId(null); }} />
                        : <button className="wit wit-btn" title="Open details" onClick={() => onOpen(w.id)}>{w.title}</button>}
                      {editing
                        ? <>
                            <select className="wi-sel" value={draft.type} title="Type"
                              onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as WiType }))}>
                              {WI_TYPE_OPTS.map((t) => <option key={t} value={t}>{WI_TYPES[t].label}</option>)}
                            </select>
                            <select className="wi-sel" value={draft.assignee} title="Assignee"
                              onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))}>
                              <option value="">Unassigned</option>
                              {!people.includes(draft.assignee) && draft.assignee && <option value={draft.assignee}>{draft.assignee}</option>}
                              {people.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </>
                        : (w.assignee
                            ? <Avatar name={w.assignee} size={20} />
                            : <span className="wi-unassigned" title="Unassigned">—</span>)}
                      <select className="wi-sel state" value={dstate} title="State"
                        style={{ color: st.color, background: `color-mix(in oklch, ${st.color} 12%, var(--surface))` }}
                        onChange={(e) => {
                          const v = e.target.value as WiState;
                          if (editing) setDraft((d) => ({ ...d, state: v }));
                          else onMove(w.id, v); // flow-checked engine transition
                        }}>
                        {editing
                          ? WI_STATE_OPTS.map((s) => <option key={s} value={s}>{WI_STATES[s].label}</option>)
                          : <>
                              <option value={w.state}>{WI_STATES[w.state].label}</option>
                              {legalWiMoves(w).map((s) => <option key={s} value={s}>→ {WI_STATES[s].label}</option>)}
                            </>}
                      </select>
                      {editing
                        ? <>
                            <button className="wi-act ok" title="Save" onClick={() => saveEdit(w.id)} disabled={!draft.title.trim()}>✓</button>
                            <button className="wi-act" title="Cancel" onClick={() => setEditingId(null)}>✕</button>
                          </>
                        : <>
                            <button className="wi-act" title="Open details" onClick={() => onOpen(w.id)}>↗</button>
                            <button className="wi-act" title="Edit" onClick={() => startEdit(w)}>✎</button>
                            <button className="wi-act del" title="Delete" onClick={() => onDelete(w.id)}>✕</button>
                          </>}
                    </div>
                  );
                })}
              </div>
            </>}

        {adding
          ? <div className="wi-addrow">
              <select className="wi-sel" value={newDraft.type} title="Type"
                onChange={(e) => setNewDraft((d) => ({ ...d, type: e.target.value as WiType }))}>
                {WI_TYPE_OPTS.map((t) => <option key={t} value={t}>{WI_TYPES[t].label}</option>)}
              </select>
              <input className="wi-inp" placeholder="Work item title…" autoFocus value={newDraft.title}
                onChange={(e) => setNewDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") submitNew(); if (e.key === "Escape") setAdding(false); }} />
              <select className="wi-sel" value={newDraft.assignee} title="Assignee"
                onChange={(e) => setNewDraft((d) => ({ ...d, assignee: e.target.value }))}>
                <option value="">Unassigned</option>
                {people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="wi-act ok" title="Add" onClick={submitNew} disabled={!newDraft.title.trim()}>✓</button>
              <button className="wi-act" title="Cancel" onClick={() => setAdding(false)}>✕</button>
            </div>
          : <button className="wi-add" onClick={openAdd}>＋ Add work item</button>}
      </div>
    </div>
  );
}
