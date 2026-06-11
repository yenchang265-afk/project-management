"use client";

import { useEffect, useMemo, useState } from "react";
import type { Item } from "@/lib/engine";
import { fetchAllSprints, type SprintInfo } from "@/lib/api";
import {
  calendarEntries, entriesByDate, monthGrid, tsToIsoDate,
  type CalendarEntry, type CalendarEntryKind,
} from "@/lib/calendar";

/* Month calendar (Jira "calendar view"): sprint boundaries, work-item due
   dates, and planned phase exits on a Monday-first grid. All plotting logic
   lives in the pure src/lib/calendar.ts helpers — this component only
   renders the grid and pages between months. */

const KIND_STYLE: Record<CalendarEntryKind, { icon: string; cls: string }> = {
  sprint_start: { icon: "▶", cls: "var(--accent)" },
  sprint_end: { icon: "■", cls: "var(--accent)" },
  wi_due: { icon: "◷", cls: "var(--danger, #c4453d)" },
  phase_exit: { icon: "◇", cls: "var(--text-3)" },
};

interface CalendarViewProps {
  items: Item[];
  onOpen: (itemId: string, wiId: string | null) => void;
}

export function CalendarView({ items, onOpen }: CalendarViewProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0..11
  const [sprints, setSprints] = useState<SprintInfo[]>([]);

  useEffect(() => {
    let stale = false;
    fetchAllSprints().then((r) => { if (!stale && r.ok) setSprints(r.data.sprints); });
    return () => { stale = true; };
  }, []);

  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const byDate = useMemo(() => entriesByDate(calendarEntries(items, sprints)), [items, sprints]);
  const today = tsToIsoDate(Date.now());

  function page(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function entryTitle(e: CalendarEntry): string {
    return e.kind === "wi_due" ? `due · ${e.label}${e.done ? " (done)" : ""}` : e.label;
  }

  return (
    <div className="card" style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "14px 18px" }}>
      <div className="card-h">
        <h3>Calendar <span className="wi-cc">{monthLabel}</span></h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="act" onClick={() => page(-1)} aria-label="Previous month">‹</button>
          <button className="act" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}>Today</button>
          <button className="act" onClick={() => page(1)} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="card-b scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12 }}>
          <thead>
            <tr>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <th key={d} className="mono" style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid var(--border-2)", color: "var(--text-3)" }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day) => {
                  const entries = byDate.get(day.date) || [];
                  return (
                    <td key={day.date} style={{
                      verticalAlign: "top", height: 86, padding: "4px 6px",
                      border: "1px solid var(--border-1)",
                      opacity: day.inMonth ? 1 : 0.45,
                      background: day.date === today ? "var(--bg-2, #f4f4f6)" : undefined,
                    }}>
                      <div className="mono" style={{ fontSize: 10, color: day.date === today ? "var(--accent)" : "var(--text-3)", paddingBottom: 2 }}>
                        {Number(day.date.slice(8))}
                      </div>
                      {entries.map((e, i) => {
                        const s = KIND_STYLE[e.kind];
                        const clickable = !!e.itemId;
                        return (
                          <div key={i} title={entryTitle(e)}
                            onClick={clickable ? () => onOpen(e.itemId!, e.wiId ?? null) : undefined}
                            style={{
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                              cursor: clickable ? "pointer" : "default",
                              color: s.cls,
                              textDecoration: e.kind === "wi_due" && e.done ? "line-through" : undefined,
                              fontSize: 11, lineHeight: "15px",
                            }}>
                            {s.icon} {e.label}
                          </div>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rep-legend mono" style={{ paddingTop: 8 }}>
          <span><span className="rep-leg-dot" style={{ background: "var(--accent)" }} />▶ ■ sprint start / end</span>
          <span><span className="rep-leg-dot" style={{ background: "var(--danger, #c4453d)" }} />◷ work-item due date</span>
          <span><span className="rep-leg-dot" style={{ background: "var(--text-3)" }} />◇ planned phase exit</span>
        </div>
      </div>
    </div>
  );
}
