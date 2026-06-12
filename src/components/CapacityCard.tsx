"use client";

import { useEffect, useMemo, useState } from "react";
import type { Item } from "@/lib/engine";
import { teamCapacity } from "@/lib/reports";
import { fetchAllSprints, type SprintInfo, type TeamInfo } from "@/lib/api";

/* Plans-lite (Jira Plans, scoped down): one capacity row per team —
   points committed to ACTIVE sprints vs the team's average velocity over
   CLOSED sprints. ratio > 1 = the team is committing more than it
   historically finishes. */

interface CapacityCardProps {
  items: Item[];
  teams: TeamInfo[];
}

export function CapacityCard({ items, teams }: CapacityCardProps) {
  const [sprints, setSprints] = useState<SprintInfo[]>([]);

  useEffect(() => {
    let stale = false;
    fetchAllSprints().then((r) => { if (!stale && r.ok) setSprints(r.data.sprints); });
    return () => { stale = true; };
  }, []);

  const rows = useMemo(() => teams.map((team) => {
    const teamProjects = new Set(team.projectIds);
    const teamItems = items.filter((it) => it.project && teamProjects.has(it.project));
    const teamSprints = sprints.filter((s) => s.teamId === team.id);
    const cap = teamCapacity(
      teamItems,
      teamSprints.filter((s) => s.state === "active").map((s) => s.name),
      teamSprints.filter((s) => s.state === "closed").map((s) => s.name),
    );
    return { team, ...cap };
  }), [teams, items, sprints]);

  return (
    <div className="card" style={{ margin: "0 18px 14px" }}>
      <div className="card-h"><h3>Team capacity</h3>
        <span className="mono rep-sub">active-sprint commitment vs avg velocity (closed sprints)</span></div>
      <div className="card-b">
        {rows.length === 0 && <div className="wi-empty">No teams.</div>}
        {rows.map(({ team, committed, velocityAvg, ratio }) => (
          <div key={team.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
            <span style={{ width: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>{team.name}</span>
            <span className="mono">{committed} pts committed</span>
            <span className="mono" style={{ color: "var(--text-3)" }}>avg velocity {velocityAvg.toFixed(1)}</span>
            <div style={{ flex: 1, height: 8, background: "var(--bg-2, #f4f4f6)", borderRadius: 3 }}
              title={ratio != null ? `${Math.round(ratio * 100)}% of historical velocity` : "no closed-sprint history"}>
              {ratio != null &&
                <div style={{
                  width: Math.min(100, ratio * 100) + "%", height: "100%", borderRadius: 3,
                  background: ratio > 1 ? "var(--danger, #c4453d)" : "var(--ok)",
                }} />}
            </div>
            <span className="mono" style={{ width: 70, textAlign: "right", color: ratio != null && ratio > 1 ? "var(--danger, #c4453d)" : "var(--text-3)" }}>
              {ratio != null ? Math.round(ratio * 100) + "%" : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
