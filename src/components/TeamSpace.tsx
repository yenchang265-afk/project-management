"use client";

import { useMemo, useState } from "react";
import { deriveItem, wiBlockedBy, type Item, type WiState, type WorkItem } from "@/lib/engine";
import type { ProjectInfo, TeamInfo, TeamMemberInfo } from "@/lib/api";
import { Avatar, TypeBox, WI_STATES } from "./badges";

const COLUMNS: WiState[] = ["todo", "in_progress", "in_review", "blocked", "done"];

interface TeamSpaceProps {
  team: TeamInfo;
  projects: ProjectInfo[];
  items: Item[];
  users: TeamMemberInfo[];
  canManage: boolean;
  onMove: (itemId: string, wiId: string, to: WiState) => void;
  onOpen: (itemId: string, wiId: string) => void;
  onSelectItem: (id: string) => void;
  onMemberOp: (userId: string, op: "add" | "remove") => void;
  onProjectOp: (projectId: string, op: "add" | "remove") => void;
}

interface TeamWi extends WorkItem { itemId: string; itemTitle: string; blockedBy: string[]; }

/* ---------------- TEAM SPACE — scrum template ----------------
   Members · owned projects · sprint picker · sprint board (flow-checked drags)
   · ranked backlog (work items with no sprint) · committed/done points. */
export function TeamSpace({ team, projects, items, users, canManage, onMove, onOpen, onSelectItem, onMemberOp, onProjectOp }: TeamSpaceProps) {
  const memberIds = new Set(team.members.map((m) => m.id));
  const addableUsers = users.filter((u) => !memberIds.has(u.id));
  const addableProjects = projects.filter((p) => !team.projectIds.includes(p.id));
  const owned = projects.filter((p) => team.projectIds.includes(p.id));
  const ownedIds = new Set(owned.map((p) => p.id));
  const teamItems = useMemo(() => items.filter((it) => it.project && ownedIds.has(it.project)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, team.id]);

  const wis: TeamWi[] = useMemo(() => teamItems.flatMap((it) => {
    const snap = deriveItem(it);
    return snap.workItems.map((w) => ({ ...w, itemId: it.id, itemTitle: it.title, blockedBy: wiBlockedBy(snap, w.id) }));
  }), [teamItems]);

  const sprints = useMemo(
    () => Array.from(new Set(wis.map((w) => w.sprint).filter(Boolean) as string[])).sort(),
    [wis]);
  const [sprint, setSprint] = useState<string | null>(null);
  const active = sprint ?? sprints[sprints.length - 1] ?? null; // default: latest sprint

  const sprintWis = wis.filter((w) => active && w.sprint === active);
  const backlog = wis.filter((w) => !w.sprint && w.state !== "done");

  const committed = sprintWis.reduce((n, w) => n + (w.storyPoints || 0), 0);
  const donePts = sprintWis.filter((w) => w.state === "done").reduce((n, w) => n + (w.storyPoints || 0), 0);
  const doneCount = sprintWis.filter((w) => w.state === "done").length;
  const pct = committed ? Math.round((donePts / committed) * 100)
    : sprintWis.length ? Math.round((doneCount / sprintWis.length) * 100) : 0;

  const [drag, setDrag] = useState<{ itemId: string; wiId: string } | null>(null);
  function drop(e: React.DragEvent, to: WiState) {
    e.preventDefault();
    if (!drag) return;
    const cur = sprintWis.find((w) => w.id === drag.wiId);
    if (cur && cur.state !== to) onMove(drag.itemId, drag.wiId, to);
    setDrag(null);
  }

  function card(w: TeamWi) {
    return (
      <div key={w.id} className="board-card" draggable
        onDragStart={() => setDrag({ itemId: w.itemId, wiId: w.id })}
        onDragEnd={() => setDrag(null)}
        onClick={() => onOpen(w.itemId, w.id)}>
        <div className="board-card-h">
          <TypeBox type={w.type} size={14} />
          <span className="mono board-card-id">{w.id}</span>
          {w.blockedBy.length > 0 && w.state !== "done" &&
            <span className="board-card-blocked" title={`Blocked by ${w.blockedBy.join(", ")}`}>⛓</span>}
          {w.priority != null && <span className="board-card-prio mono">P{w.priority}</span>}
        </div>
        <div className="board-card-title">{w.title}</div>
        <div className="board-card-f">
          <span className="board-chip" title={w.itemTitle}>{w.itemId}</span>
          {w.storyPoints != null && <span className="board-chip pts mono">{w.storyPoints}</span>}
          <span className="spacer"></span>
          {w.assignee && <Avatar name={w.assignee} size={18} />}
        </div>
      </div>
    );
  }

  return (
    <div className="teamspace scroll">
      {/* header: identity + members */}
      <div className="ts-head">
        <span className="org-glyph ts-glyph">{team.name[0]}</span>
        <div className="ts-id">
          <h1>{team.name}</h1>
          <div className="ts-projects">
            {owned.map((p) => (
              <span className="board-chip ts-proj" key={p.id} title={p.description || ""}>
                {p.key} · {p.name}
                {canManage && <button className="ts-x" title={`Remove ${p.name}`} onClick={() => onProjectOp(p.id, "remove")}>×</button>}
              </span>
            ))}
            {owned.length === 0 && <span className="wi-empty">No projects owned yet.</span>}
            {canManage && addableProjects.length > 0 &&
              <select className="wi-sel ts-add" value="" title="Add project"
                onChange={(e) => { if (e.target.value) onProjectOp(e.target.value, "add"); }}>
                <option value="">＋ project…</option>
                {addableProjects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>}
          </div>
        </div>
        <div className="spacer"></div>
        <div className="ts-members">
          {team.members.map((m) => (
            <div className="ts-member" key={m.id} title={`${m.name} · ${m.role === "PM" ? "Product" : "Engineering"}`}>
              <Avatar name={m.name} size={26} />
              <span className="ts-mname">{m.name}</span>
              <span className="kpill">{m.role}</span>
              {canManage && <button className="ts-x" title={`Remove ${m.name}`} onClick={() => onMemberOp(m.id, "remove")}>×</button>}
            </div>
          ))}
          {canManage && addableUsers.length > 0 &&
            <select className="wi-sel ts-add" value="" title="Add member"
              onChange={(e) => { if (e.target.value) onMemberOp(e.target.value, "add"); }}>
              <option value="">＋ member…</option>
              {addableUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
            </select>}
        </div>
      </div>

      {/* sprint board */}
      <div className="card ts-card">
        <div className="card-h">
          <h3>⟳ Sprint board</h3>
          <div className="ts-sprintbar">
            <select className="wi-sel" value={active ?? ""} onChange={(e) => setSprint(e.target.value || null)} title="Sprint">
              {sprints.length === 0 && <option value="">No sprints yet</option>}
              {sprints.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="mono ts-stats">
              {committed ? `${donePts}/${committed} pts` : `${doneCount}/${sprintWis.length} items`} · {pct}%
            </span>
            <div className="wi-prog ts-prog"><div className="bar"><div className="fill" style={{ width: pct + "%" }}></div></div></div>
          </div>
        </div>
        <div className="card-b">
          {sprintWis.length === 0
            ? <div className="wi-empty">Nothing scheduled{active ? ` in ${active}` : ""} — pull items up from the backlog (set their sprint in the drawer).</div>
            : <div className="ts-board">
                {COLUMNS.map((c) => (
                  <div key={c} className="ts-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, c)}>
                    <div className="board-col-head" style={{ color: WI_STATES[c].color }}>
                      {WI_STATES[c].label}
                      <span className="mono board-col-n">{sprintWis.filter((w) => w.state === c).length}</span>
                    </div>
                    <div className="ts-colbody">{sprintWis.filter((w) => w.state === c).map(card)}</div>
                  </div>
                ))}
              </div>}
        </div>
      </div>

      {/* backlog */}
      <div className="card ts-card">
        <div className="card-h">
          <h3>☰ Backlog</h3>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
            {backlog.length} unscheduled · {backlog.reduce((n, w) => n + (w.storyPoints || 0), 0)} pts</span>
        </div>
        <div className="card-b">
          {backlog.length === 0
            ? <div className="wi-empty">Backlog is empty.</div>
            : <div className="wilist">
                {backlog.map((w) => (
                  <div className="wirow" key={w.id}>
                    <TypeBox type={w.type} />
                    <span className="wid">{w.id}</span>
                    {w.blockedBy.length > 0 && <span className="wi-blocked" title={`Blocked by ${w.blockedBy.join(", ")}`}>⛓</span>}
                    <button className="wit wit-btn" title="Open details" onClick={() => onOpen(w.itemId, w.id)}>{w.title}</button>
                    <button className="board-chip ts-itemlink" title={w.itemTitle} onClick={() => onSelectItem(w.itemId)}>{w.itemId}</button>
                    {w.storyPoints != null && <span className="board-chip pts mono">{w.storyPoints}</span>}
                    <span className="ts-rowstate" style={{ color: WI_STATES[w.state].color }}>{WI_STATES[w.state].label}</span>
                    {w.assignee ? <Avatar name={w.assignee} size={20} /> : <span className="wi-unassigned">—</span>}
                  </div>
                ))}
              </div>}
        </div>
      </div>

      <div className="foot-note">scrum template · sprint board pulls from {owned.map((p) => p.key).join(" + ") || "—"} · moves are flow-checked by the engine</div>
    </div>
  );
}
