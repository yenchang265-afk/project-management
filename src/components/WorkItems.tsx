"use client";

import type { Item, WiType } from "@/lib/engine";
import { Avatar, TypeBox, WI_STATES, WI_TYPES } from "./badges";

/* ---------------- WORK ITEMS (typed children: story / task / bug) ---------------- */
export function WorkItems({ item }: { item: Item }) {
  const wi = item.workItems || [];
  // type breakdown, in a stable display order
  const order: WiType[] = ["story", "task", "bug"];
  const counts: Partial<Record<WiType, number>> = {};
  wi.forEach((w) => { counts[w.type] = (counts[w.type] || 0) + 1; });
  const types = order.filter((k) => counts[k]);
  const doneN = wi.filter((w) => w.state === "done").length;
  const pct = wi.length ? Math.round((doneN / wi.length) * 100) : 0;
  return (
    <div className="card">
      <div className="card-h">
        <h3>⊞ Work items</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          {wi.length ? `${doneN}/${wi.length} done` : "none yet"}</span>
      </div>
      <div className="card-b">
        {wi.length === 0
          ? <div className="wi-empty">No work items linked to this feature yet.</div>
          : <>
              <div className="witypes">
                {types.map((k) => (
                  <span className="witag" key={k}><TypeBox type={k} size={16} />{counts[k]} {WI_TYPES[k].label}{counts[k]! > 1 ? "s" : ""}</span>
                ))}
              </div>
              <div className="wi-prog">
                <div className="bar"><div className="fill" style={{ width: pct + "%" }}></div></div>
                <span className="lb">{pct}%</span>
              </div>
              <div className="wilist">
                {wi.map((w) => {
                  const st = WI_STATES[w.state] || WI_STATES.todo;
                  return (
                    <div className="wirow" key={w.id}>
                      <TypeBox type={w.type} />
                      <span className="wid">{w.id}</span>
                      <span className="wit">{w.title}</span>
                      <Avatar name={w.assignee} size={20} />
                      <span className="wistate" style={{ color: st.color, background: `color-mix(in oklch, ${st.color} 14%, var(--surface))` }}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </>}
      </div>
    </div>
  );
}
