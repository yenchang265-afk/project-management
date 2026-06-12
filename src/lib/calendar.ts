/* =========================================================================
   Calendar — pure helpers for the month view (no React/DOM/DB).
   Plots three entry kinds on a Monday-first month grid:
     · sprint boundaries  (from the sprint registry's start/end dates)
     · work-item due dates (WorkItem.dueDate, YYYY-MM-DD)
     · planned phase exits (item CREATE ts + cumulative phase budgets —
       the same budgets planVsActual measures against)
   ========================================================================= */

import { PHASE_BUDGET, STATES, deriveItem, type Item, type StateKey } from "./engine";

const DAY_MS = 24 * 3600e3;

export interface CalendarDay {
  date: string;     // YYYY-MM-DD
  inMonth: boolean; // false for leading/trailing padding days
}

export type CalendarEntryKind = "sprint_start" | "sprint_end" | "wi_due" | "phase_exit";

export interface CalendarEntry {
  date: string;     // YYYY-MM-DD
  kind: CalendarEntryKind;
  label: string;
  itemId?: string;  // wi_due / phase_exit
  wiId?: string;    // wi_due
  done?: boolean;   // wi_due: the work item is done
}

/** Minimal sprint shape the calendar needs (SprintInfo satisfies it). */
export interface CalendarSprint {
  name: string;
  start?: string | null;
  end?: string | null;
}

/** Local-time YYYY-MM-DD for a ms timestamp. */
export function tsToIsoDate(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Monday-first weeks covering the month (month0 = 0..11); padding days flagged. */
export function monthGrid(year: number, month0: number): CalendarDay[][] {
  const first = new Date(year, month0, 1);
  // back up to Monday (getDay(): 0 = Sunday)
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month0, 1 - lead);
  const weeks: CalendarDay[][] = [];
  const cur = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: tsToIsoDate(cur.getTime()), inMonth: cur.getMonth() === month0 });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  } while (cur.getMonth() === month0);
  return weeks;
}

/** Collect all plottable entries; the view filters them onto the visible grid. */
export function calendarEntries(items: Item[], sprints: CalendarSprint[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];

  for (const s of sprints) {
    if (s.start) out.push({ date: s.start, kind: "sprint_start", label: `${s.name} starts` });
    if (s.end) out.push({ date: s.end, kind: "sprint_end", label: `${s.name} ends` });
  }

  for (const item of items) {
    const snap = deriveItem(item);
    for (const w of snap.workItems)
      if (w.dueDate)
        out.push({
          date: w.dueDate, kind: "wi_due", label: `${w.id} · ${w.title}`,
          itemId: item.id, wiId: w.id, done: w.state === "done",
        });

    // planned phase exits: CREATE ts + cumulative budget days per spine phase
    const createTs = item.events.find((e) => e.type === "CREATE")?.ts;
    if (createTs == null) continue;
    const budget = { ...PHASE_BUDGET, ...(item.plan || {}) };
    const spine = (Object.values(STATES) as { key: StateKey; label: string; spine?: number }[])
      .filter((s) => s.spine != null)
      .sort((a, b) => a.spine! - b.spine!);
    let cumDays = 0;
    for (const s of spine) {
      const days = budget[s.key] || 0;
      if (days <= 0) continue;
      cumDays += days;
      out.push({
        date: tsToIsoDate(createTs + cumDays * DAY_MS),
        kind: "phase_exit",
        label: `${item.id} · ${s.label} exit (plan)`,
        itemId: item.id,
      });
    }
  }
  return out;
}

/** Group entries by date for O(1) lookup while rendering the grid. */
export function entriesByDate(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}
