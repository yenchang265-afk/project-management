"use client";

import React from "react";
import { STATES, deriveItem, type Item } from "@/lib/engine";
import type { ProjectInfo, TeamInfo } from "@/lib/api";
import { TypeBox, laneClass } from "./badges";

/* Project → epic → feature item tree, grouped by item.project. Extracted from
   Navigator so the Backlog view can render the same selectable tree the sidebar
   used to. Preserves the .nav-* markup (nav-group/nav-head/nav-glabel/nav-item)
   so styling and any selectors keep working. Pure: derives state per render. */

function navLaneOf(it: Item) {
  return STATES[deriveItem(it).state].lane;
}
function navMatchLane(it: Item, filter: string) {
  if (filter === "all") return true;
  const lane = navLaneOf(it);
  if (filter === "closed") return lane === "closed" || lane === "off";
  return lane === filter;
}

interface ProjectTreeProps {
  items: Item[];
  projects: ProjectInfo[];
  teams: TeamInfo[];
  selId: string;
  onSelect: (id: string) => void;
  filter: string;
  search: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}

export function ProjectTree({ items, projects, teams, selId, onSelect, filter, search, collapsed, onToggle }: ProjectTreeProps) {
  const q = (search || "").trim().toLowerCase();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const matchText = (it: Item) => !q || it.id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q);
  const matches = items.filter((it) => navMatchLane(it, filter) && matchText(it));
  const matchSet = new Set(matches.map((i) => i.id));
  const shown = new Set(matchSet);
  matches.forEach((it) => { let p = it.parent; while (p && byId[p]) { shown.add(p); p = byId[p].parent; } });
  const isOpen = (k: string) => !collapsed.has(k);
  const projectShown = (pid: string) => items.filter((it) => it.project === pid && shown.has(it.id));
  const projectCount = (pid: string) => items.filter((it) => it.project === pid && matchSet.has(it.id)).length;
  const childrenOf = (id: string) => items.filter((it) => it.parent === id && shown.has(it.id));
  const knownIds = new Set(projects.map((p) => p.id));
  const orphanShown = items.filter((it) => (!it.project || !knownIds.has(it.project)) && shown.has(it.id));

  function renderItem(it: Item, depth: number): React.ReactNode {
    const kids = childrenOf(it.id);
    const hasKids = kids.length > 0;
    const ek = "e:" + it.id;
    const open = isOpen(ek);
    const s = deriveItem(it);
    return (
      <React.Fragment key={it.id}>
        <button className={"nav-item " + laneClass(s.state)} data-sel={it.id === selId} data-dim={!matchSet.has(it.id)}
          style={{ paddingLeft: depth * 15 + 8 }} onClick={() => onSelect(it.id)}
          title={it.title + " · " + STATES[s.state].label}>
          {hasKids
            ? <span className="nav-chev" data-open={open} onClick={(e) => { e.stopPropagation(); onToggle(ek); }}>▸</span>
            : <span className="nav-leaf"></span>}
          <TypeBox type={it.type} size={15} />
          <span className="ni-id">{it.id}</span>
          <span className="ni-ti">{it.title}</span>
          {s.flags.blocked && <span className="ni-flag" title="Blocked">⚑</span>}
          {s.flags.on_hold && <span className="ni-flag hold" title="On hold">⏸</span>}
          <span className="ni-lane" style={{ background: "var(--lc)" }} title={STATES[s.state].label}></span>
        </button>
        {hasKids && open && kids.map((k) => renderItem(k, depth + 1))}
      </React.Fragment>
    );
  }

  function renderProject(p: ProjectInfo) {
    const pk = "p:" + p.id;
    const popen = isOpen(pk);
    const tops = projectShown(p.id).filter((it) => !it.parent || !shown.has(it.parent));
    if (!tops.length) return null;
    const owners = teams.filter((t) => p.teamIds.includes(t.id)).map((t) => t.name).join(", ");
    return (
      <div className="nav-group" key={p.id}>
        <button className="nav-head" data-lvl="0" onClick={() => onToggle(pk)} title={owners ? `Owned by ${owners}` : undefined}>
          <span className="nav-chev" data-open={popen}>▸</span>
          <span className="nav-pkey mono">{p.key}</span>
          <span className="nav-glabel">{p.name}</span>
          <span className="nav-count">{projectCount(p.id)}</span>
        </button>
        {popen && tops.map((it) => renderItem(it, 1))}
      </div>
    );
  }

  const anyProject = projects.some((p) => projectShown(p.id).length > 0);

  return (
    <div className="nav">
      <div className="nav-section">Projects</div>
      {!anyProject && !orphanShown.length && <div className="nav-empty">No items match.</div>}
      {projects.map(renderProject)}
      {orphanShown.length > 0 && (
        <div className="nav-group" key="__none">
          <button className="nav-head" data-lvl="0" onClick={() => onToggle("p:none")}>
            <span className="nav-chev" data-open={isOpen("p:none")}>▸</span>
            <span className="nav-glabel">No project</span>
            <span className="nav-count">{orphanShown.length}</span>
          </button>
          {isOpen("p:none") && orphanShown.filter((it) => !it.parent || !shown.has(it.parent)).map((it) => renderItem(it, 1))}
        </div>
      )}
    </div>
  );
}
