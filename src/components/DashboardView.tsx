"use client";

import { STATES, deriveItem, type Item, type Lane } from "@/lib/engine";
import type { AnnouncementInfo, ApiUser, OrgInfo, ProjectInfo, TeamInfo } from "@/lib/api";
import { WI_STATES } from "./badges";
import { RecentWork } from "./RecentWork";
import { Announcements } from "./Announcements";
import { CfdCard, CreatedResolvedCard } from "./Reports";
import { AuditLog } from "./AuditLog";
import { GoalsCard } from "./GoalsCard";

/* ---------------- DASHBOARD (default landing) ----------------
   Personalized to the signed-in user: their teams, their orgs, their assigned
   work. Below that, a rollup over everything they can see — which for an admin
   (PM) is the whole company, and for everyone else is just their scoped slice
   (the server already filters reads by team membership). */

const LANES: { key: Lane; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "build", label: "Build" },
  { key: "verify", label: "Verify" },
  { key: "release", label: "Release" },
  { key: "closed", label: "Closed" },
];

type Snap = ReturnType<typeof deriveItem>;

function laneOf(snap: Snap): Lane {
  const lane = STATES[snap.state].lane;
  return lane === "off" ? "closed" : lane;
}
function spread(snaps: Snap[]): Record<Lane, number> {
  const out = { discovery: 0, build: 0, verify: 0, release: 0, closed: 0, off: 0 } as Record<Lane, number>;
  snaps.forEach((s) => { out[laneOf(s)]++; });
  return out;
}

function LaneBar({ counts, total }: { counts: Record<Lane, number>; total: number }) {
  return (
    <div className="lanebar" title={`${total} items`}>
      {LANES.map((l) => {
        const n = counts[l.key];
        if (!n) return null;
        return <span key={l.key} className={"lanebar-seg lane-" + l.key}
          style={{ width: (n / total) * 100 + "%", background: "var(--lc)" }} title={`${l.label}: ${n}`} />;
      })}
      {total === 0 && <span className="lanebar-empty" />}
    </div>
  );
}

export function DashboardView({ me, orgs, projects, teams, items, announcements, canManage, onDeleteAnn, annName, onSelectItem, onOpenWork }:
  { me: ApiUser; orgs: OrgInfo[]; projects: ProjectInfo[]; teams: TeamInfo[]; items: Item[];
    announcements: AnnouncementInfo[]; canManage: boolean; onDeleteAnn: (id: string) => void;
    annName: (a: AnnouncementInfo) => string | null;
    onSelectItem: (id: string) => void; onOpenWork: (itemId: string, wiId: string) => void }) {
  const isAdmin = me.role === "PM";
  const total = items.length;
  // derive each item once; every rollup below reads from these snapshots
  const snaps = items.map(deriveItem);
  const snapById = new Map(items.map((it, i) => [it.id, snaps[i]]));
  const counts = spread(snaps);
  const riskItems = snaps.filter((s) => s.activeRisks.size > 0);

  const myTeams = teams.filter((t) => t.members.some((m) => m.id === me.id));
  const myOrgIds = new Set(myTeams.map((t) => t.orgId).filter(Boolean) as string[]);
  const myOrgs = orgs.filter((o) => myOrgIds.has(o.id));

  // work items assigned to me, across everything I can see
  const myWork = items.flatMap((it, i) =>
    snaps[i].workItems
      .filter((w) => w.assignee && w.assignee === me.name)
      .map((w) => ({ id: w.id, title: w.title, state: w.state, itemId: it.id, itemTitle: it.title })));

  return (
    <main className="detail scroll">
      <div className="company-wrap dash-wrap">
        <div className="ov-head">
          <div>
            <h1 className="ov-title">Welcome, {me.name.split(" ")[0]}</h1>
            <div className="ov-sub mono">{isAdmin ? "admin · full company view" : "your workspace"}</div>
          </div>
        </div>

        {/* KPI hero */}
        <div className="kpis ov-kpis">
          <div className="kpi"><span className="kv">{orgs.length}</span><span className="kl">Orgs</span></div>
          <div className="kpi"><span className="kv">{projects.length}</span><span className="kl">Projects</span></div>
          <div className="kpi"><span className="kv">{teams.length}</span><span className="kl">Teams</span></div>
          <div className="kpi"><span className="kv">{total}</span><span className="kl">Items</span></div>
          <div className="kpi"><span className="kv" style={{ color: riskItems.length ? "var(--warn)" : "var(--text)" }}>{riskItems.length}</span>
            <span className="kl">At-risk items</span></div>
        </div>

        <div className="dash-grid">
          {/* main column */}
          <div className="dash-main">
            <div className="card">
              <div className="card-h"><h3>Lifecycle spread</h3>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{isAdmin ? "all items" : "your items"} by lane</span></div>
              <div className="card-b">
                <LaneBar counts={counts} total={total} />
                <div className="lane-legend">
                  {LANES.map((l) => (
                    <span key={l.key} className="lane-leg">
                      <span className={"lane-dot lane-" + l.key} style={{ background: "var(--lc)" }} />
                      {l.label} <b className="mono">{counts[l.key]}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-h"><h3>Per-project health</h3>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{projects.length} projects</span></div>
              <div className="card-b">
                <div className="proj-health">
                  {projects.map((p) => {
                    const pit = items.filter((it) => it.project === p.id);
                    const psnaps = pit.map((it) => snapById.get(it.id)!);
                    return (
                      <div className="ph-row" key={p.id}>
                        <div className="ph-meta">
                          <span className="nav-pkey mono">{p.key}</span>
                          <span className="ph-name">{p.name}</span>
                          <span className="ph-count mono">{pit.length}</span>
                        </div>
                        <LaneBar counts={spread(psnaps)} total={pit.length} />
                      </div>
                    );
                  })}
                  {!projects.length && <div className="nav-empty">No projects in view.</div>}
                </div>
              </div>
            </div>

            <CfdCard items={items} />

            <GoalsCard items={items} canManage={isAdmin} onSelectItem={onSelectItem} />

            <CreatedResolvedCard items={items} />

            <RecentWork items={items} onOpen={onOpenWork} limit={8} />

            {isAdmin && <AuditLog onSelectItem={onSelectItem} />}
          </div>

          {/* right rail */}
          <div className="dash-rail">
            {announcements.length > 0 &&
              <Announcements items={announcements} canManage={canManage} onDelete={onDeleteAnn} resolveName={annName} />}

            <div className="card">
              <div className="card-h"><h3>You</h3>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{myTeams.length} teams · {myOrgs.length} orgs</span></div>
              <div className="card-b dash-you">
                <div className="dash-you-sec">
                  <div className="org-sec-l">Teams</div>
                  <div className="dash-chips">
                    {myTeams.map((t) => <span key={t.id} className="dash-chip"><span className="nav-teamglyph">{t.name[0]}</span>{t.name}</span>)}
                    {!myTeams.length && <span className="nav-empty">Not on a team yet.</span>}
                  </div>
                </div>
                <div className="dash-you-sec">
                  <div className="org-sec-l">Orgs</div>
                  <div className="dash-chips">
                    {myOrgs.map((o) => <span key={o.id} className="dash-chip">{o.name}</span>)}
                    {!myOrgs.length && <span className="nav-empty">No org.</span>}
                  </div>
                </div>
                <div className="dash-you-sec">
                  <div className="org-sec-l">Assigned to you · {myWork.length}</div>
                  <div className="dash-work">
                    {myWork.map((w) => (
                      <button key={w.itemId + ":" + w.id} className="dash-work-row" onClick={() => onSelectItem(w.itemId)}>
                        <span className="dash-work-state" style={{ background: WI_STATES[w.state].color }} />
                        <span className="dash-work-ti">{w.title}</span>
                        <span className="dash-work-parent mono">{w.itemId}</span>
                      </button>
                    ))}
                    {!myWork.length && <div className="nav-empty">Nothing assigned to you.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
