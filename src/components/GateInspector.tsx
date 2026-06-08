"use client";

import { SHIFT_LEFT, gateStatus, type ConditionState, type GateKey, type Role, type Snapshot } from "@/lib/engine";
import { Avatar } from "./badges";

/* ---------------- GATE INSPECTOR ---------------- */
interface GateInspectorProps {
  gateKey: GateKey;
  snap: Snapshot;
  role: Role;
  onSatisfy: (key: string) => void;
  onWaive: (key: string) => void;
  onSignoff: (gate: GateKey, slot: Role) => void;
  onShiftLeft?: (risk: string, value: boolean) => void;
  showShiftLeft: boolean;
}

export function GateInspector({ gateKey, snap, role, onSatisfy, onWaive, onSignoff, onShiftLeft, showShiftLeft }: GateInspectorProps) {
  const gs = gateStatus(gateKey, snap);
  const CSTATE_ICON: Record<ConditionState, string> = { satisfied: "✓", required: "!", waived: "~", not_applicable: "·" };
  return (
    <div className="card">
      <div className="card-h">
        <h3>◆ {gs.gate.label} gate</h3>
        <span className={"gate-status " + (gs.open ? "open" : "blocked")}>
          <span className="chip" style={{ padding: 0 }}><span className="d"></span></span>
          {gs.open ? "Open" : `${gs.blocking.length} blocking`}
        </span>
      </div>
      <div className="card-b">
        {gs.conds.map((c) => {
          const na = c.state === "not_applicable";
          const owns = c.owner === role;
          return (
            <div className="cond" data-na={na} key={c.key}>
              <span className={"cstate " + c.state}>{CSTATE_ICON[c.state]}</span>
              <span className="cmain">
                <span className="clabel">{c.label}</span>
                <span className="ckey">{c.key} · {c.state}{c.track ? ` · track:${c.track}` : ""}</span>
              </span>
              <span className="cowner">{c.owner}</span>
              {c.state === "required" && !c.track &&
                <button className="cbtn sat" disabled={!owns}
                  title={owns ? "" : `Only ${c.owner} can satisfy this`}
                  onClick={() => onSatisfy(c.key)}>Satisfy</button>}
              {c.state === "required" && !c.track &&
                <button className="cbtn" disabled={!owns} onClick={() => onWaive(c.key)}>Waive</button>}
              {c.state === "satisfied" && <span className="ckey" style={{ color: "var(--ok)" }}>done</span>}
              {c.state === "waived" && <span className="ckey">waived</span>}
              {c.track && c.state === "required" &&
                <span className="ckey" style={{ color: "var(--warn)" }}>via sub-track</span>}
              {na && <span className="ckey">n/a</span>}
            </div>
          );
        })}

        {showShiftLeft && gateKey === "ready_for_dev" && onShiftLeft &&
          <ShiftLeft snap={snap} role={role} onShiftLeft={onShiftLeft} />}

        <div className="signoff">
          {(["PM", "Dev"] as Role[]).map((r) => {
            const who = gs.signoff[r];
            const canSign = role === r && !who;
            return (
              <div className="so" data-on={!!who} key={r}>
                <div className="so-h"><span>{r} sign-off</span>{who ? <span style={{ color: "var(--ok)" }}>✓</span> : ""}</div>
                {who
                  ? <div className="so-who"><Avatar name={who} size={20} />{who}</div>
                  : <button className="so-btn" disabled={!canSign}
                      title={canSign ? "" : `Switch to ${r} to sign`}
                      onClick={() => onSignoff(gateKey, r)}>
                      {role === r ? `Sign as ${r}` : `Awaiting ${r}`}</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShiftLeft({ snap, role, onShiftLeft }: { snap: Snapshot; role: Role; onShiftLeft: (risk: string, value: boolean) => void }) {
  return (
    <div className="shiftleft" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
      <div className="card-h" style={{ padding: "0 0 8px", border: "none" }}>
        <h3 style={{ letterSpacing: ".04em" }}>Shift-left risk checklist</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>PM-owned</span>
      </div>
      {SHIFT_LEFT.map((r) => {
        const on = snap.activeRisks.has(r.key);
        return (
          <button className="sl-row" key={r.key} style={{ width: "100%", textAlign: "left", background: "none" }}
            disabled={role !== "PM"} onClick={() => onShiftLeft(r.key, !on)}
            title={role !== "PM" ? "Only PM can set risk flags" : ""}>
            <span className="sl-check" data-on={on}>{on ? "✓" : ""}</span>
            <span className="sl-lb">{r.label}</span>
            <span className="sl-eff">→ {r.turnsOn.join(", ")}</span>
          </button>
        );
      })}
      <div className="sl-note">Ticking a risk flips its conditional conditions from <b>not&nbsp;applicable → required</b> for this and the release gate.</div>
    </div>
  );
}
