import { describe, it, expect } from "vitest";
import { monthGrid, tsToIsoDate, calendarEntries, entriesByDate } from "./calendar";
import { PHASE_BUDGET, STATES, type Item, type PdlcEvent, type StateKey } from "./engine";

/* Calendar — pure month-grid + entry collection (no React/DOM/DB).
   Entries: sprint boundaries, WI due dates, planned phase exits. */

const CREATE_TS = new Date(2026, 5, 1).getTime(); // 2026-06-01 local

function makeItem(over: Partial<Item> = {}): Item {
  const create: PdlcEvent = { id: "e1", item: "PAY-412", type: "CREATE", actor: "Maya", role: "PM", ts: CREATE_TS, to: "backlog" };
  return {
    id: "PAY-412", title: "Apple Pay", area: "Payments", priority: "High",
    parent: null, type: "feature", stakeholders: [], workItems: [], events: [create],
    ...over,
  };
}

describe("monthGrid", () => {
  it("covers the whole month in Monday-first weeks of 7", () => {
    const weeks = monthGrid(2026, 5); // June 2026
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const first = new Date(weeks[0][0].date + "T00:00:00");
    expect(first.getDay()).toBe(1); // Monday
    const inMonth = weeks.flat().filter((d) => d.inMonth).map((d) => d.date);
    expect(inMonth.length).toBe(30);
    expect(inMonth[0]).toBe("2026-06-01");
    expect(inMonth[29]).toBe("2026-06-30");
    // out-of-month padding is flagged
    expect(weeks.flat().every((d) => d.inMonth === d.date.startsWith("2026-06"))).toBe(true);
  });
});

describe("tsToIsoDate", () => {
  it("formats a local timestamp as YYYY-MM-DD", () => {
    expect(tsToIsoDate(new Date(2026, 5, 15).getTime())).toBe("2026-06-15");
  });
});

describe("calendarEntries", () => {
  it("emits sprint start/end entries", () => {
    const es = calendarEntries([], [{ name: "S1", start: "2026-06-02", end: "2026-06-16" }]);
    expect(es).toContainEqual(expect.objectContaining({ kind: "sprint_start", date: "2026-06-02" }));
    expect(es).toContainEqual(expect.objectContaining({ kind: "sprint_end", date: "2026-06-16" }));
  });

  it("skips sprints without dates", () => {
    expect(calendarEntries([], [{ name: "S?", start: null, end: null }])).toEqual([]);
  });

  it("emits work-item due entries with a done flag", () => {
    const item = makeItem({
      workItems: [
        { id: "PAY-418", type: "story", title: "Button", state: "done", assignee: "Sam", dueDate: "2026-06-10" },
        { id: "PAY-419", type: "task", title: "No due", state: "todo", assignee: "Sam" },
      ],
    });
    const es = calendarEntries([item], []);
    const due = es.filter((e) => e.kind === "wi_due");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ date: "2026-06-10", itemId: "PAY-412", wiId: "PAY-418", done: true });
  });

  it("emits planned phase exits at CREATE + cumulative budget days", () => {
    const es = calendarEntries([makeItem()], []);
    const exits = es.filter((e) => e.kind === "phase_exit");
    const spine = (Object.values(STATES) as { key: StateKey; spine?: number }[])
      .filter((s) => s.spine != null).sort((a, b) => a.spine! - b.spine!);
    const budgeted = spine.filter((s) => (PHASE_BUDGET[s.key] || 0) > 0);
    expect(exits).toHaveLength(budgeted.length);
    // first budgeted phase exits exactly its budget after creation
    const firstDays = PHASE_BUDGET[budgeted[0].key]!;
    expect(exits[0].date).toBe(tsToIsoDate(CREATE_TS + firstDays * 24 * 3600e3));
    expect(exits[0].itemId).toBe("PAY-412");
  });
});

describe("entriesByDate", () => {
  it("groups entries by date", () => {
    const es = calendarEntries([], [{ name: "S1", start: "2026-06-02", end: "2026-06-02" }]);
    const map = entriesByDate(es);
    expect(map.get("2026-06-02")).toHaveLength(2);
  });
});
