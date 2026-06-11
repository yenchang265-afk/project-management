"use client";

import { GATES, SUBTRACK_LABELS, TRANSITIONS, label, type Item, type PdlcEvent } from "@/lib/engine";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./badges";

/* ---------------- HISTORY (event-sourced log, reverse chrono) ---------------- */
const WI_FIELD_LABELS: Record<string, string> = {
  acceptanceCriteria: "acceptance criteria",
  storyPoints: "story points",
};

function describeEvent(e: PdlcEvent): { k: string; icon: string; body: React.ReactNode } {
  switch (e.type) {
    case "CREATE":
      return { k: "meta", icon: "＋", body: <span className="l1">Item created in <b>{label(e.to as string)}</b></span> };
    case "TRANSITION":
      return { k: e.kind || "meta", icon: "→",
        body: <>
          <span className="l1"><b>{transLabel(e)}</b></span>
          <span className="trans">{label(e.from as string)}<span className="arr">→</span>{label(e.to as string)}</span>
        </> };
    case "CONDITION_SATISFY":
      return { k: "meta", icon: "✓", body: <span className="l1">Satisfied condition <span className="mono">{e.condition}</span></span> };
    case "CONDITION_WAIVE":
      return { k: "meta", icon: "~", body: <span className="l1">Waived condition <span className="mono">{e.condition}</span></span> };
    case "GATE_SIGNOFF":
      return { k: "meta", icon: "✓", body: <span className="l1">Signed off <b>{GATES[e.gate!].label}</b> gate as {e.role}</span> };
    case "SUBTRACK":
      return { k: "meta", icon: "◆", body: <span className="l1"><b style={{ textTransform: "capitalize" }}>{e.track}</b> review → <b>{SUBTRACK_LABELS[e.to as keyof typeof SUBTRACK_LABELS]}</b></span> };
    case "FLAG_SET":
      return { k: e.value ? "rework" : "meta", icon: "⚑",
        body: <span className="l1">{e.value ? "Flagged" : "Cleared"} <b>{e.flag === "on_hold" ? "on hold" : e.flag}</b></span> };
    case "SHIFT_LEFT_SET":
      return { k: "meta", icon: "⚑", body: <span className="l1">Risk <span className="mono">{e.risk}</span> {e.value ? "flagged" : "cleared"}</span> };
    case "SPAWN_CHILD":
      return { k: "forward", icon: "⎇", body: <span className="l1">Spawned next-iteration child <b>{e.child}</b></span> };
    case "WI_CREATE":
      return { k: "forward", icon: "＋", body: <span className="l1">Added work item <b>{e.wiId}</b>{e.wi?.type ? <span className="mono"> · {e.wi.type}</span> : null}</span> };
    case "WI_UPDATE": {
      const fields = Object.keys(e.wi || {}).map((k) => WI_FIELD_LABELS[k] || k);
      return { k: "meta", icon: "✎", body: <span className="l1">Updated work item <b>{e.wiId}</b>{fields.length ? <span className="mono"> · {fields.join(", ")}</span> : null}</span> };
    }
    case "WI_DELETE":
      return { k: "rework", icon: "✕", body: <span className="l1">Removed work item <b>{e.wiId}</b></span> };
    case "WI_COMMENT":
      return { k: "meta", icon: "💬", body: <span className="l1">Commented on <b>{e.wiId}</b></span> };
    case "ITEM_COMMENT":
      return { k: "meta", icon: "💬", body: <span className="l1">Commented on the item</span> };
    default:
      return { k: "meta", icon: "·", body: <span className="l1">{e.type}</span> };
  }
}

function transLabel(e: PdlcEvent): string {
  const def = TRANSITIONS.find((t) => t.from === e.from && t.to === e.to);
  return def ? def.label : `${label(e.from as string)} → ${label(e.to as string)}`;
}

export function History({ item }: { item: Item }) {
  const evs = item.events.slice().sort((a, b) => b.ts - a.ts);
  return (
    <div className="card">
      <div className="card-h">
        <h3>History</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{evs.length} events · append-only</span>
      </div>
      <div className="card-b">
        <div className="timeline">
          {evs.map((e) => {
            const d = describeEvent(e);
            return (
              <div className="tl" data-k={d.k} key={e.id}>
                <div className="rail"></div>
                <div className="node">{d.icon}</div>
                <div className="tc">
                  {d.body}
                  <span className="l2">
                    <Avatar name={e.actor} size={15} /> {e.actor}
                    <span className="kpill">{e.role}</span>
                    <span>· {timeAgo(e.ts)}</span>
                  </span>
                  {e.reason && <span className="reason">&ldquo;{String(e.reason).replace(/_/g, " ")}&rdquo;</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
