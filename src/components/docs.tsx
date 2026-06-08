"use client";

import { STATES, type Item, type Role, type Snapshot, type StateKey } from "@/lib/engine";

/* ---------------- REQUIREMENT DOCS (which spec is signed off at which node) ---------------- */
export interface ReqDoc {
  key: string;
  abbr: string;
  label: string;
  node: StateKey;
  nodeLabel: string;
  owner: Role;
  color: string;
  condition?: string;
}

export const REQ_DOCS: ReqDoc[] = [
  { key: "urd", abbr: "URD", label: "User Requirements",        node: "in_discovery",     nodeLabel: "Discovery",        owner: "PM",  color: "oklch(0.56 0.12 200)" },
  { key: "prd", abbr: "PRD", label: "Product Requirements",     node: "defined",          nodeLabel: "Defined",          owner: "PM",  color: "oklch(0.55 0.16 295)", condition: "spec_approved" },
  { key: "erd", abbr: "ERD", label: "Engineering Requirements", node: "technical_design", nodeLabel: "Technical design", owner: "Dev", color: "oklch(0.55 0.13 245)", condition: "design_reviewed" },
];

export type DocStatusKey = "approved" | "in_review" | "waived" | "pending";

export const DOC_STATUS: Record<DocStatusKey, { label: string; color: string }> = {
  approved:  { label: "Approved",  color: "var(--ok)" },
  in_review: { label: "In review", color: "oklch(0.55 0.12 72)" },
  waived:    { label: "Waived",    color: "var(--text-3)" },
  pending:   { label: "Pending",   color: "var(--text-3)" },
};

// derive a doc's sign-off status from the live snapshot (conditions + phase progress)
export function docStatus(snap: Snapshot, doc: ReqDoc): DocStatusKey {
  const curSpine = STATES[snap.state] ? STATES[snap.state].spine ?? null : null;
  const nodeSpine = STATES[doc.node].spine!;
  if (doc.condition) {
    const c = snap.conditions[doc.condition];
    if (c === "satisfied") return "approved";
    if (c === "waived") return "waived";
    return curSpine != null && curSpine >= nodeSpine ? "in_review" : "pending";
  }
  // URD has no explicit gate condition — it's implicitly signed off once discovery is left
  if (curSpine == null) return "pending";
  if (curSpine > nodeSpine) return "approved";
  if (curSpine === nodeSpine) return "in_review";
  return "pending";
}

export function RequirementDocs({ item, snap }: { item: Item; snap: Snapshot }) {
  const num = item.id.split("-")[1] || "";
  return (
    <div className="card">
      <div className="card-h">
        <h3>Requirement docs</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>spec sign-off by node</span>
      </div>
      <div className="card-b">
        <div className="doc-list">
          {REQ_DOCS.map((d) => {
            const stt = docStatus(snap, d);
            const meta = DOC_STATUS[stt];
            return (
              <div className="doc-row" key={d.key}>
                <span className="doc-abbr mono" style={{ background: d.color }}>{d.abbr}</span>
                <div className="doc-main">
                  <span className="doc-title">{d.label}</span>
                  <span className="doc-sub">{d.abbr}-{num} · <span className="doc-node">{d.nodeLabel}</span> · {d.owner}</span>
                </div>
                <span className="doc-status" style={{ color: meta.color, background: `color-mix(in oklch, ${meta.color} 14%, var(--surface))` }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
