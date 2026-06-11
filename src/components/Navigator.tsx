"use client";

import React from "react";
import { STATES, deriveItem, type Item } from "@/lib/engine";
import type { OrgInfo, ProjectInfo, TeamInfo } from "@/lib/api";
import { Avatar, TypeBox, laneClass } from "./badges";

/* ---------------- NAVIGATOR (projects → epic → feature tree · teams) ----------------
   Phase 2: grouping is by PROJECT (item.project), no longer by the static
   org→group→team fixture. Teams are spaces, not item containers. */
function navLaneOf(it: Item) {
  const st = deriveItem(it).state;
  return STATES[st].lane;
}

function navMatchLane(it: Item, filter: string) {
  if (filter === "all") return true;
  const lane = navLaneOf(it);
  if (filter === "closed") return lane === "closed" || lane === "off";
  return lane === filter;
}

interface NavigatorProps {
  mode: "projects" | "org";
  meId: string;
  orgs: OrgInfo[];
  projects: ProjectInfo[];
  teams: TeamInfo[];
  items: Item[];
  selId: string;
  selTeamId: string | null;
  selOrgId: string | null;
  onSelect: (id: string) => void;
  onSelectTeam: (teamId: string) => void;
  onSelectOrg: (orgId: string) => void;
  filter: string;
  search: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}

export function Navigator({ mode, meId, orgs, projects, teams, items, selId, selTeamId, selOrgId, onSelect, onSelectTeam, onSelectOrg, filter, search, collapsed, onToggle }: NavigatorProps) {
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
  // items whose project is unknown (or null) still need a home
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

  if (mode === "org") {
    const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
    const myOrgIds = new Set(teams.filter((t) => t.orgId && t.members.some((m) => m.id === meId)).map((t) => t.orgId as string));
    const matchOrg = (name: string) => !q || name.toLowerCase().includes(q);
    const mine = orgs.filter((o) => myOrgIds.has(o.id) && matchOrg(o.name));
    const others = orgs.filter((o) => !myOrgIds.has(o.id) && matchOrg(o.name));
    const orgless = teams.filter((t) => !t.orgId);

    const orgRow = (o: OrgInfo) => {
      const k = "o:" + o.id;
      const open = isOpen(k);
      const visTeams = o.teamIds.map((id) => teamById[id]).filter(Boolean) as TeamInfo[];
      return (
        <div className="nav-group" key={o.id}>
          <button className="nav-head" data-lvl="0" data-sel={o.id === selOrgId && !selTeamId} onClick={() => onSelectOrg(o.id)}>
            <span className="nav-chev" data-open={open && visTeams.length > 0}
              onClick={(e) => { e.stopPropagation(); onToggle(k); }}>▸</span>
            <span className="nav-glabel">{o.name}</span>
            <span className="nav-count">{o.teamIds.length}</span>
          </button>
          {open && visTeams.map((t) => (
            <button className="nav-teamrow nav-org-team" key={t.id} data-sel={t.id === selTeamId}
              onClick={() => onSelectTeam(t.id)} title={`Open ${t.name} team space`}>
              <span className="nav-teamglyph">{t.name[0]}</span>
              <span className="nav-tlabel">{t.name}</span>
              <span className="nav-count">{t.members.length}</span>
            </button>
          ))}
        </div>
      );
    };

    return (
      <div className="nav">
        <div className="nav-section">My orgs</div>
        {mine.map(orgRow)}
        {!mine.length && <div className="nav-empty">{q ? "No match." : "You don’t belong to any org."}</div>}
        {(others.length > 0 || (q && !mine.length)) && <>
          <div className="nav-section">Other orgs</div>
          {others.map(orgRow)}
          {!others.length && <div className="nav-empty">No match.</div>}
        </>}
        {orgless.length > 0 && matchOrg("unassigned") && (
          <div className="nav-group" key="__unassigned">
            <button className="nav-head" data-lvl="0" data-sel={selOrgId === "__unassigned" && !selTeamId} onClick={() => onSelectOrg("__unassigned")}>
              <span className="nav-chev" data-open={isOpen("o:__unassigned")}
                onClick={(e) => { e.stopPropagation(); onToggle("o:__unassigned"); }}>▸</span>
              <span className="nav-glabel">Unassigned</span>
              <span className="nav-count">{orgless.length}</span>
            </button>
            {isOpen("o:__unassigned") && orgless.map((t) => (
              <button className="nav-teamrow nav-org-team" key={t.id} data-sel={t.id === selTeamId}
                onClick={() => onSelectTeam(t.id)} title={`Open ${t.name} team space`}>
                <span className="nav-teamglyph">{t.name[0]}</span>
                <span className="nav-tlabel">{t.name}</span>
                <span className="nav-count">{t.members.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

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
