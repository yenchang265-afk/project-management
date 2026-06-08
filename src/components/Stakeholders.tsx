"use client";

import type { Item, Snapshot, Stakeholder } from "@/lib/engine";
import { Avatar } from "./badges";

/* ---------------- STAKEHOLDERS (PDLC roles) ---------------- */
export const SH_COLORS: Record<string, string> = {
  "Product Manager":     "oklch(0.55 0.16 295)",
  "Engineering Manager": "oklch(0.5 0.13 250)",
  "Tech Lead":           "oklch(0.55 0.13 210)",
  "Designer":            "oklch(0.56 0.15 330)",
  "QA Lead":             "oklch(0.56 0.12 175)",
  "Security Reviewer":   "oklch(0.6 0.14 55)",
  "Compliance / Legal":  "oklch(0.6 0.12 72)",
};

export function Stakeholders({ item, snap }: { item: Item; snap: Snapshot }) {
  const list: Stakeholder[] = (item.stakeholders || []).slice();
  // derived: privacy / data-store risk flags pull in a Compliance reviewer
  const risks = snap && snap.activeRisks ? snap.activeRisks : new Set<string>();
  const needCompliance = risks.has("touches_pii") || risks.has("new_data_store");
  if (needCompliance && !list.some((s) => s.role === "Compliance / Legal"))
    list.push({ role: "Compliance / Legal", name: "Grace Bauer", derived: true });
  return (
    <div className="card">
      <div className="card-h">
        <h3>People &amp; stakeholders</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{list.length} roles</span>
      </div>
      <div className="card-b">
        <div className="sh-list">
          {list.map((s) => {
            const c = SH_COLORS[s.role] || "var(--text-3)";
            return (
              <div className="sh-row" key={s.role}>
                <span className="sh-role" style={{ color: c }}>
                  <span className="sh-dot" style={{ background: c }}></span>{s.role}</span>
                <div className="sh-who"><Avatar name={s.name} size={24} /><span>{s.name}</span></div>
                {s.derived && <span className="sh-tag" title="Added automatically because privacy / data-store risk flags are set">auto · risk</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
