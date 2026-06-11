"use client";

import type { ProjectInfo, TeamInfo } from "@/lib/api";
import { Avatar } from "./badges";

/* ---------------- ORG VIEW (structure chart) ----------------
   Isolated top-level workspace: the M:N people/ownership structure —
   each team → its members → the projects it owns. Read-only. */

export function OrgView({ projects, teams }: { projects: ProjectInfo[]; teams: TeamInfo[] }) {
  const projById = Object.fromEntries(projects.map((p) => [p.id, p]));

  return (
    <main className="detail board-main">
      <div className="company-wrap">
        <div className="ov-head">
          <div>
            <h1 className="ov-title">Organization</h1>
            <div className="ov-sub mono">{teams.length} teams · {projects.length} projects</div>
          </div>
        </div>

        <div className="org-grid">
          {teams.map((t) => {
            const owned = t.projectIds.map((id) => projById[id]).filter(Boolean) as ProjectInfo[];
            return (
              <div className="org-card" key={t.id}>
                <div className="org-card-h">
                  <span className="nav-teamglyph">{t.name[0]}</span>
                  <span className="org-card-name">{t.name}</span>
                  <span className="nav-count mono">{t.members.length}</span>
                </div>

                <div className="org-sec">
                  <div className="org-sec-l">Members</div>
                  <div className="org-members">
                    {t.members.map((m) => (
                      <span className="org-member" key={m.id} title={`${m.name} · ${m.role}`}>
                        <Avatar name={m.name} size={20} />
                        <span className="om-name">{m.name}</span>
                        <span className="kpill" data-role={m.role}>{m.role}</span>
                      </span>
                    ))}
                    {!t.members.length && <span className="nav-empty">No members.</span>}
                  </div>
                </div>

                <div className="org-sec">
                  <div className="org-sec-l">Owns projects</div>
                  <div className="org-projects">
                    {owned.map((p) => (
                      <span className="org-projtag" key={p.id} title={p.name}>
                        <span className="nav-pkey mono">{p.key}</span>
                        <span className="op-name">{p.name}</span>
                      </span>
                    ))}
                    {!owned.length && <span className="nav-empty">No projects.</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {!teams.length && <div className="nav-empty">No teams.</div>}
        </div>
      </div>
    </main>
  );
}
