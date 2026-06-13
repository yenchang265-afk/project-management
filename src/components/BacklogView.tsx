"use client";

import type { Item } from "@/lib/engine";
import type { ProjectInfo, TeamInfo } from "@/lib/api";
import { LANE_FILTERS } from "./constants";
import { ProjectTree } from "./ProjectTree";

/* Backlog view (Jira-style): the project → item tree that used to live in the
   left sidebar now renders here as the main content of the "Backlog" nav entry.
   Clicking an item routes to its Details view (onSelect = selectItem). The lane
   filter, formerly in the sidebar, lives in this page header. */

interface BacklogViewProps {
  items: Item[];                       // already project-scoped by the caller
  projects: ProjectInfo[];
  teams: TeamInfo[];
  selId: string;
  onSelect: (id: string) => void;
  filter: string;
  onFilter: (f: string) => void;
  search: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  laneCount: (f: string) => number;
}

export function BacklogView({ items, projects, teams, selId, onSelect, filter, onFilter, search, collapsed, onToggle, laneCount }: BacklogViewProps) {
  return (
    <>
      <div className="page-head">
        <h2>Backlog</h2>
        <div className="spacer"></div>
        <div className="lanefilter">
          {LANE_FILTERS.map((f) => (
            <button key={f.key} data-on={filter === f.key} onClick={() => onFilter(f.key)}>
              {f.label} <span className="mono" style={{ opacity: 0.6 }}>{laneCount(f.key)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="backlog-scroll scroll">
        <ProjectTree items={items} projects={projects} teams={teams}
          selId={selId} onSelect={onSelect}
          filter={filter} search={search} collapsed={collapsed} onToggle={onToggle} />
      </div>
    </>
  );
}
