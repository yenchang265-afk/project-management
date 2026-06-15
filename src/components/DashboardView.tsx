"use client";

import { deriveItem, type Item } from "@/lib/engine";
import type { AnnouncementInfo, ApiUser, ProjectInfo, TeamInfo } from "@/lib/api";
import { WI_STATES } from "./badges";
import { RecentWork } from "./RecentWork";
import { Announcements } from "./Announcements";

/* ---------------- DASHBOARD — personal "your work" home ----------------
   Jira/Azure-DevOps style: lead with the signed-in user's own work, not
   company analytics (those moved to the Reports view). Shows what's assigned
   to me, what I touched recently, and quick links into my teams & projects. */

interface DashboardViewProps {
  me: ApiUser;
  projects: ProjectInfo[];
  teams: TeamInfo[];
  items: Item[];
  announcements: AnnouncementInfo[];
  canManage: boolean;
  onDeleteAnn: (id: string) => void;
  annName: (a: AnnouncementInfo) => string | null;
  onSelectItem: (id: string) => void;
  onOpenWork: (itemId: string, wiId: string) => void;
  onSelectTeam: (teamId: string) => void;
  onSelectProject: (projectId: string) => void;
}

export function DashboardView({
  me, projects, teams, items, announcements, canManage, onDeleteAnn, annName,
  onSelectItem, onOpenWork, onSelectTeam, onSelectProject,
}: DashboardViewProps) {
  const snaps = items.map(deriveItem);

  // work items assigned to me, across everything I can see
  const myWork = items.flatMap((it, i) =>
    snaps[i].workItems
      .filter((w) => w.assignee && w.assignee === me.name)
      .map((w) => ({ id: w.id, title: w.title, state: w.state, itemId: it.id })));
  const myOpen = myWork.filter((w) => w.state !== "done");
  const myDone = myWork.filter((w) => w.state === "done");
  const myWorkOrdered = [...myOpen, ...myDone]; // open first, done after

  // items I'm assigned in that carry an active (shift-left) risk
  const myRisk = items.filter((_, i) =>
    snaps[i].activeRisks.size > 0 && snaps[i].workItems.some((w) => w.assignee === me.name)).length;

  const myTeams = teams.filter((t) => t.members.some((m) => m.id === me.id));
  const myProjectIds = new Set(myTeams.flatMap((t) => t.projectIds));
  const myProjects = projects.filter((p) => myProjectIds.has(p.id));

  return (
    <main className="detail scroll">
      <div className="company-wrap dash-wrap">
        <div className="ov-head">
          <div>
            <h1 className="ov-title">Welcome, {me.name.split(" ")[0]}</h1>
            <div className="ov-sub mono">your work · {myTeams.length} team{myTeams.length === 1 ? "" : "s"}</div>
          </div>
        </div>

        {/* personal stats (not company rollups) */}
        <div className="kpis ov-kpis">
          <div className="kpi"><span className="kv">{myOpen.length}</span><span className="kl">Open · mine</span></div>
          <div className="kpi"><span className="kv" style={{ color: myRisk ? "var(--warn)" : "var(--text)" }}>{myRisk}</span><span className="kl">At-risk · mine</span></div>
          <div className="kpi"><span className="kv">{myWork.length}</span><span className="kl">Assigned total</span></div>
          <div className="kpi"><span className="kv">{myProjects.length}</span><span className="kl">My projects</span></div>
        </div>

        <div className="dash-grid">
          <div className="dash-main">
            {/* Assigned to me — the home hero */}
            <div className="card">
              <div className="card-h">
                <h3>Assigned to me <span className="wi-cc">{myWork.length}</span></h3>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>open first</span>
              </div>
              <div className="card-b">
                <div className="dash-work">
                  {myWorkOrdered.map((w) => (
                    <button key={w.itemId + ":" + w.id} className="dash-work-row" onClick={() => onOpenWork(w.itemId, w.id)}
                      data-done={w.state === "done"}>
                      <span className="dash-work-state" style={{ background: WI_STATES[w.state].color }} />
                      <span className="dash-work-ti">{w.title}</span>
                      <span className="dash-work-parent mono">{w.itemId}</span>
                    </button>
                  ))}
                  {!myWork.length && <div className="nav-empty">Nothing assigned to you.</div>}
                </div>
              </div>
            </div>

            {/* Recently worked */}
            <RecentWork items={items} onOpen={onOpenWork} limit={10} />
          </div>

          {/* right rail — announcements + quick links */}
          <div className="dash-rail">
            {announcements.length > 0 &&
              <Announcements items={announcements} canManage={canManage} onDelete={onDeleteAnn} resolveName={annName} />}

            <div className="card">
              <div className="card-h"><h3>My teams</h3>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{myTeams.length}</span></div>
              <div className="card-b">
                <div className="dash-chips">
                  {myTeams.map((t) => (
                    <button key={t.id} className="dash-chip" onClick={() => onSelectTeam(t.id)} title={`Open ${t.name}`}>
                      <span className="nav-teamglyph">{t.name[0]}</span>{t.name}
                    </button>
                  ))}
                  {!myTeams.length && <span className="nav-empty">Not on a team yet.</span>}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-h"><h3>My projects</h3>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{myProjects.length}</span></div>
              <div className="card-b">
                <div className="dash-chips">
                  {myProjects.map((p) => (
                    <button key={p.id} className="dash-chip" onClick={() => onSelectProject(p.id)} title={`Open ${p.name}`}>
                      <span className="nav-pkey mono">{p.key}</span> {p.name}
                    </button>
                  ))}
                  {!myProjects.length && <span className="nav-empty">No projects yet.</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
