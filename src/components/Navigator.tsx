"use client";

import React from "react";
import { STATES, deriveItem, type Item } from "@/lib/engine";
import { TypeBox, laneClass } from "./badges";

/* ---------------- NAVIGATOR (org → group → team → epic → feature tree) ---------------- */
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
  groups: { key: string; label: string; teams: string[] }[];
  items: Item[];
  selId: string;
  onSelect: (id: string) => void;
  filter: string;
  search: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}

export function Navigator({ groups, items, selId, onSelect, filter, search, collapsed, onToggle }: NavigatorProps) {
  const q = (search || "").trim().toLowerCase();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const matchText = (it: Item) => !q || it.id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q);
  const matches = items.filter((it) => navMatchLane(it, filter) && matchText(it));
  const matchSet = new Set(matches.map((i) => i.id));
  const shown = new Set(matchSet);
  matches.forEach((it) => { let p = it.parent; while (p && byId[p]) { shown.add(p); p = byId[p].parent; } });
  const isOpen = (k: string) => !collapsed.has(k);
  const teamShown = (team: string) => items.filter((it) => it.area === team && shown.has(it.id));
  const teamCount = (team: string) => items.filter((it) => it.area === team && matchSet.has(it.id)).length;
  const childrenOf = (id: string) => items.filter((it) => it.parent === id && shown.has(it.id));

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

  const visibleGroups = groups.filter((g) => g.teams.some((tm) => teamShown(tm).length));
  if (!visibleGroups.length) return <div className="nav-empty">No items match.</div>;
  return (
    <div className="nav">
      {visibleGroups.map((g) => {
        const gk = "g:" + g.key;
        const gopen = isOpen(gk);
        const teams = g.teams.filter((tm) => teamShown(tm).length);
        const gcount = teams.reduce((n, tm) => n + teamCount(tm), 0);
        return (
          <div className="nav-group" key={g.key}>
            <button className="nav-head" data-lvl="0" onClick={() => onToggle(gk)}>
              <span className="nav-chev" data-open={gopen}>▸</span>
              <span className="nav-glabel">{g.label}</span>
              <span className="nav-count">{gcount}</span>
            </button>
            {gopen && teams.map((tm) => {
              const tk = "t:" + tm;
              const topen = isOpen(tk);
              const tops = teamShown(tm).filter((it) => !it.parent || !shown.has(it.parent));
              return (
                <div className="nav-team" key={tm}>
                  <button className="nav-head" data-lvl="1" style={{ paddingLeft: 22 }} onClick={() => onToggle(tk)}>
                    <span className="nav-chev" data-open={topen}>▸</span>
                    <span className="nav-tlabel">{tm}</span>
                    <span className="nav-count">{teamCount(tm)}</span>
                  </button>
                  {topen && tops.map((it) => renderItem(it, 2))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
