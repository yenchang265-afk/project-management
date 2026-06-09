"use client";

import { useState } from "react";
import {
  REJECT_REASONS, label, legalTransitions,
  type Role, type Snapshot, type TransitionDef, type TransitionKind,
} from "@/lib/engine";

/* ---------------- ACTIONS ---------------- */
const KIND_ICON: Record<TransitionKind, string> = { forward: "→", rework: "↺", terminal: "⊘", recovery: "⤺", hotfix: "⚡" };

interface ActionsProps {
  snap: Snapshot;
  role: Role;
  onTransition: (def: TransitionDef, reason: string | null) => void;
}

export function Actions({ snap, role, onTransition }: ActionsProps) {
  const legal = legalTransitions(snap.state);
  const [pop, setPop] = useState<{ def: TransitionDef; x: number; y: number } | null>(null);
  if (!legal.length)
    return <div className="empty-actions">Terminal state — no transitions available.</div>;

  // sort: forward gates first, forward, rework, recovery, terminal
  const order: Record<TransitionKind, number> = { forward: 0, hotfix: 1, recovery: 2, rework: 3, terminal: 4 };
  const sorted = legal.slice().sort((a, b) => (order[a.kind] - order[b.kind]) || (b.gate ? 1 : 0));

  function click(def: TransitionDef, e: React.MouseEvent<HTMLButtonElement>) {
    if (def.needsReason) {
      const r = e.currentTarget.getBoundingClientRect();
      setPop({ def, x: r.left, y: r.bottom + 6 });
    } else onTransition(def, null);
  }

  return (
    <>
      <div className="actions">
        {sorted.map((def) => {
          const allowed = def.roles.includes(role);
          const isGate = !!def.gate;
          const cls = "act " + def.kind + (isGate ? " gate" : "") + (isGate && allowed ? " primary" : "");
          return (
            <button key={def.from + def.to} className={cls} disabled={!allowed}
              onClick={(e) => click(def, e)}
              title={allowed ? "" : `Requires ${def.roles.join(" or ")} role`}>
              <span className="ai">{KIND_ICON[def.kind]}</span>
              <span className="txt">
                <span className="t1">{def.label}</span>
                <span className="t2">{label(def.from)} → {label(def.to)}</span>
              </span>
              {def.kind !== "forward" && <span className="kindtag">{def.kind}</span>}
              {!allowed && <span className="kindtag">{def.roles.join("/")}</span>}
              {isGate && <span className="arrow">◆</span>}
            </button>
          );
        })}
      </div>
      {pop && <ReasonPopover def={pop.def} x={pop.x} y={pop.y}
        onClose={() => setPop(null)}
        onPick={(reason) => { onTransition(pop.def, reason); setPop(null); }} />}
    </>
  );
}

interface ReasonPopoverProps {
  def: TransitionDef;
  x: number;
  y: number;
  onClose: () => void;
  onPick: (reason: string | null) => void;
}

export function ReasonPopover({ def, x, y, onClose, onPick }: ReasonPopoverProps) {
  const [free, setFree] = useState("");
  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="pop" style={{ left: Math.min(x, window.innerWidth - 220), top: y }}>
        <div className="ph">{def.needsReason === "reject" ? "Rejection reason" : "Reason (optional)"}</div>
        {def.needsReason === "reject"
          ? REJECT_REASONS.map((r) => (
              <button key={r} onClick={() => onPick(r)}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{r}</span>
              </button>))
          : <>
              <input autoFocus placeholder="why…" value={free}
                onChange={(e) => setFree(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onPick(free || null)} />
              <button className="pgo" onClick={() => onPick(free || null)}>Confirm</button>
            </>}
      </div>
    </>
  );
}
