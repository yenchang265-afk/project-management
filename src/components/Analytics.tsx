"use client";

import { leadTime, reworkRate, type Item } from "@/lib/engine";
import { dur } from "@/lib/format";
import { CollapsibleCard } from "./CollapsibleCard";

/* ---------------- ANALYTICS ---------------- */
export function Analytics({ item }: { item: Item }) {
  const rework = reworkRate(item);
  const lead = leadTime(item);
  return (
    <CollapsibleCard title="Analytics" sub="derived from log">
        <div className="kpis">
          <div className="kpi"><span className="kv">{dur(lead)}</span><span className="kl">Lead time</span><span className="ku">since created</span></div>
          <div className="kpi"><span className="kv" style={{ color: rework ? "var(--warn)" : "var(--text)" }}>{rework}</span><span className="kl">Rework loops</span><span className="ku">backward moves</span></div>
          <div className="kpi"><span className="kv">{item.events.length}</span><span className="kl">Log events</span><span className="ku">source of truth</span></div>
        </div>
    </CollapsibleCard>
  );
}
