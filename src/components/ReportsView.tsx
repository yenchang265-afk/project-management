"use client";

import { STATES, deriveItem, type Item, type Lane } from "@/lib/engine";
import type { ProjectInfo } from "@/lib/api";
import { CfdCard, CreatedResolvedCard } from "./Reports";
import { AuditLog } from "./AuditLog";
import { GoalsCard } from "./GoalsCard";
import { DashboardGadgets } from "./DashboardGadgets";
import { WorkflowCard } from "./WorkflowCard";

/* ---------------- REPORTS (analytics surface) ----------------
   The chart gadgets that used to crowd the Dashboard live here: lifecycle
   spread, per-project health, cumulative flow, created-vs-resolved, goals,
   audit log (admin), workflow viewer. Same per-user ordered gadget framework
   (DashboardGadgets + ⚙ Customize); recent_work stays on the personal
   Dashboard, so it's intentionally absent from the render map below. */

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

interface ReportsViewProps {
  isAdmin: boolean;
  projects: ProjectInfo[];
  items: Item[];
  onSelectItem: (id: string) => void;
}

export function ReportsView({ isAdmin, projects, items, onSelectItem }: ReportsViewProps) {
  const total = items.length;
  const snaps = items.map(deriveItem);
  const snapById = new Map(items.map((it, i) => [it.id, snaps[i]]));
  const counts = spread(snaps);

  return (
    <main className="detail scroll">
      <div className="company-wrap dash-wrap">
        <div className="ov-head">
          <div>
            <h1 className="ov-title">Reports</h1>
            <div className="ov-sub mono">{isAdmin ? "company-wide analytics" : "analytics across your items"}</div>
          </div>
        </div>

        <div className="dash-main">
          <DashboardGadgets isAdmin={isAdmin} render={{
            lane_spread: () => (
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
            ),
            project_health: () => (
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
            ),
            cfd: () => <CfdCard items={items} />,
            goals: () => <GoalsCard items={items} canManage={isAdmin} onSelectItem={onSelectItem} />,
            created_resolved: () => <CreatedResolvedCard items={items} />,
            audit_log: () => (isAdmin ? <AuditLog onSelectItem={onSelectItem} /> : null),
            workflow: () => <WorkflowCard />,
          }} />
        </div>
      </div>
    </main>
  );
}
