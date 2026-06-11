"use client";

import { STATES, deriveItem, type Item, type Lane } from "@/lib/engine";
import type { ProjectInfo, TeamInfo } from "@/lib/api";

/* ---------------- COMPANY VIEW (rollup dashboard across ALL projects) ----------------
   Isolated top-level workspace: counts + lifecycle spread + open risks + per-project
   health. Pure read-side; everything derived from the event log via deriveItem. */

const LANES: { key: Lane; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "build", label: "Build" },
  { key: "verify", label: "Verify" },
  { key: "release", label: "Release" },
  { key: "closed", label: "Closed" },
];

// terminals (rejected/deferred/rolled_back) live in lane "off" — fold them into Closed.
function laneOf(it: Item): Lane {
  const lane = STATES[deriveItem(it).state].lane;
  return lane === "off" ? "closed" : lane;
}

function spread(items: Item[]): Record<Lane, number> {
  const out = { discovery: 0, build: 0, verify: 0, release: 0, closed: 0, off: 0 } as Record<Lane, number>;
  items.forEach((it) => { out[laneOf(it)]++; });
  return out;
}

function LaneBar({ counts, total }: { counts: Record<Lane, number>; total: number }) {
  return (
    <div className="lanebar" title={`${total} items`}>
      {LANES.map((l) => {
        const n = counts[l.key];
        if (!n) return null;
        const pct = total ? (n / total) * 100 : 0;
        return <span key={l.key} className={"lanebar-seg lane-" + l.key}
          style={{ width: pct + "%", background: "var(--lc)" }} title={`${l.label}: ${n}`} />;
      })}
      {total === 0 && <span className="lanebar-empty" />}
    </div>
  );
}

export function CompanyView({ projects, teams, items }: { projects: ProjectInfo[]; teams: TeamInfo[]; items: Item[] }) {
  const total = items.length;
  const counts = spread(items);
  const riskItems = items.filter((it) => deriveItem(it).activeRisks.size > 0);
  const riskTotal = items.reduce((s, it) => s + deriveItem(it).activeRisks.size, 0);

  return (
    <main className="detail board-main">
      <div className="company-wrap">
        <div className="ov-head">
          <div>
            <h1 className="ov-title">Cadence</h1>
            <div className="ov-sub mono">{projects.length} projects · {teams.length} teams · {total} items</div>
          </div>
        </div>

        <div className="kpis ov-kpis">
          <div className="kpi"><span className="kv">{projects.length}</span><span className="kl">Projects</span></div>
          <div className="kpi"><span className="kv">{teams.length}</span><span className="kl">Teams</span></div>
          <div className="kpi"><span className="kv">{total}</span><span className="kl">Items</span></div>
          <div className="kpi"><span className="kv" style={{ color: riskItems.length ? "var(--warn)" : "var(--text)" }}>{riskItems.length}</span>
            <span className="kl">At-risk items</span><span className="ku">{riskTotal} active risks</span></div>
        </div>

        <div className="card">
          <div className="card-h"><h3>Lifecycle spread</h3>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>all items by lane</span></div>
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
                const pc = spread(pit);
                const owners = teams.filter((t) => p.teamIds.includes(t.id)).map((t) => t.name).join(", ");
                return (
                  <div className="ph-row" key={p.id}>
                    <div className="ph-meta">
                      <span className="nav-pkey mono">{p.key}</span>
                      <span className="ph-name">{p.name}</span>
                      <span className="ph-count mono">{pit.length}</span>
                    </div>
                    <LaneBar counts={pc} total={pit.length} />
                    {owners && <div className="ph-owners">{owners}</div>}
                  </div>
                );
              })}
              {!projects.length && <div className="nav-empty">No projects.</div>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
