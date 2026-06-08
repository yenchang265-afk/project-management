"use client";

import { GATE_BEFORE, GATES, STATES, gateStatus, spineOrder, type Snapshot } from "@/lib/engine";
import { laneClass } from "./badges";
import { DOC_STATUS, REQ_DOCS, docStatus } from "./docs";

/* ---------------- SPINE ---------------- */
export function Spine({ snap }: { snap: Snapshot }) {
  const cur = snap.state;
  const curSpine = STATES[cur] ? STATES[cur].spine : undefined;
  const nodes: React.ReactNode[] = [];
  spineOrder.forEach((st) => {
    // insert a gate diamond BEFORE the state it guards
    const gk = GATE_BEFORE[st.key];
    if (gk) {
      const gs = gateStatus(gk, snap);
      const target = st.spine!;
      let vis = "pending";
      if (curSpine != null && curSpine >= target) vis = "open";
      else if (gs.open) vis = "open";
      else if (curSpine === target - 1) vis = "blocked";
      nodes.push(
        <div className={"snode gate-node " + laneClass(st.key)} data-gs={vis} key={"g-" + gk}>
          <div className="bar" data-done={curSpine != null && curSpine >= target}></div>
          <div className="gate-dia"><span className="ic">{vis === "open" ? "✓" : "◆"}</span></div>
          <div className="lb">{GATES[gk].label}</div>
        </div>
      );
    }
    const done = curSpine != null && st.spine! < curSpine;
    const current = st.key === cur;
    const doc = REQ_DOCS.find((d) => d.node === st.key);
    nodes.push(
      <div className={"snode " + laneClass(st.key)} data-st={current ? "current" : done ? "done" : "future"} key={st.key}>
        <div className="bar" data-done={done || current}></div>
        <div className="mk">{done ? "✓" : st.spine! + 1}</div>
        <div className="lb">{st.label}</div>
        {doc && <span className="snode-doc" data-st={docStatus(snap, doc)} title={doc.label + " · " + DOC_STATUS[docStatus(snap, doc)].label}>{doc.abbr}</span>}
      </div>
    );
  });
  return (
    <div className="card spine-card">
      <div className="card-h">
        <h3>Lifecycle</h3>
        {STATES[cur] && STATES[cur].lane === "off"
          ? <span className="chip" style={{ background: "color-mix(in oklch,var(--bad) 14%,var(--surface))", color: "var(--bad)" }}>
              <span className="d"></span>Off the spine · {STATES[cur].label}</span>
          : <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
              {curSpine != null ? `phase ${curSpine + 1} / 12` : ""}</span>}
      </div>
      <div className="spine scroll">{nodes}</div>
    </div>
  );
}
