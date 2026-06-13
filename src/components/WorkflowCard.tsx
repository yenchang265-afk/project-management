"use client";

import { useState } from "react";
import { GATES, STATES, TRANSITIONS, type StateKey } from "@/lib/engine";

/* Workflow viewer (first slice of Jira's workflow editor): renders the
   declarative TRANSITIONS/GATES tables the engine actually runs — per-state
   outgoing moves, role guards, gates with their conditions, reason rules.
   Read-only by design until workflow schemes move into the DB. */

export function WorkflowCard() {
  const [sel, setSel] = useState<StateKey>("backlog");
  const outgoing = TRANSITIONS.filter((t) => t.from === sel);
  const incoming = TRANSITIONS.filter((t) => t.to === sel);
  const spine = (Object.values(STATES)).filter((s) => s.spine != null).sort((a, b) => a.spine! - b.spine!);
  const off = (Object.values(STATES)).filter((s) => s.spine == null);

  return (
    <div className="card">
      <div className="card-h"><h3>Workflow</h3>
        <span className="mono rep-sub">the declarative transition table the engine enforces</span></div>
      <div className="card-b">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 8 }}>
          {[...spine, ...off].map((s) => (
            <button key={s.key} className="act" data-on={sel === s.key}
              style={sel === s.key ? { background: "var(--accent)", color: "var(--bg-0, #fff)" } : undefined}
              onClick={() => setSel(s.key)}>
              {s.spine != null ? `${s.spine}·` : "⊘ "}{s.label}
            </button>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", paddingBottom: 4 }}>
          outgoing from {STATES[sel].label}
        </div>
        {outgoing.length === 0 && <div className="wi-empty">Terminal — no outgoing transitions.</div>}
        {outgoing.map((t) => (
          <div key={t.from + "→" + t.to} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border-1)", fontSize: 12 }}>
            <span style={{ width: 150 }}>→ {STATES[t.to].label}</span>
            <span className="kpill">{t.kind}</span>
            <span className="mono" style={{ color: "var(--text-3)" }}>{t.roles.join(" / ")}</span>
            {t.gate &&
              <span className="mono" title={GATES[t.gate].conditions.map((c) => c.label).join(", ")}
                style={{ color: "var(--warn)" }}>
                ⛩ {GATES[t.gate].label} · {GATES[t.gate].conditions.length} conditions + dual sign-off
              </span>}
            {t.needsReason && <span className="mono" style={{ color: "var(--text-3)" }}>reason required</span>}
          </div>
        ))}
        <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "8px 0 4px" }}>
          incoming · {incoming.length}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {incoming.map((t) => <span key={t.from} className="board-chip">{STATES[t.from].label}</span>)}
          {incoming.length === 0 && <span className="wi-empty">none</span>}
        </div>
      </div>
    </div>
  );
}
