import { describe, it, expect } from "vitest";
import { projectSummary } from "./summary";
import { STATES, TRANSITIONS, type Item, type PdlcEvent, type StateKey, type WorkItem } from "./engine";

/* Project summary — pure fold over a project's items (the caller pre-filters
   by project). Lane spread, gated next-steps, sprint snapshot, recent activity. */

function makeItem(id: string, state: StateKey, workItems: WorkItem[] = [], ts = 1000): Item {
  const create: PdlcEvent = { id: id + "-e1", item: id, type: "CREATE", actor: "Maya", role: "PM", ts, to: state };
  return {
    id, title: "Item " + id, area: "Payments", priority: "High",
    parent: null, type: "feature", stakeholders: [], workItems, events: [create],
  };
}

describe("projectSummary", () => {
  it("counts items per lane", () => {
    const s = projectSummary([makeItem("A-1", "backlog"), makeItem("A-2", "in_development"), makeItem("A-3", "in_qa")]);
    expect(s.laneSpread.discovery).toBe(1);
    expect(s.laneSpread.build).toBe(1);
    expect(s.laneSpread.verify).toBe(1);
    expect(s.laneSpread.closed).toBe(0);
  });

  it("lists the gate blocking each item whose next forward step is gated", () => {
    const gated = TRANSITIONS.find((t) => t.gate)!;
    const s = projectSummary([makeItem("A-1", gated.from)]);
    expect(s.gates).toHaveLength(1);
    expect(s.gates[0]).toMatchObject({ itemId: "A-1", gate: gated.gate, open: false });
    expect(s.gates[0].blocking).toBeGreaterThan(0);
  });

  it("does not list gates for items in ungated states", () => {
    const ungated = (Object.keys(STATES) as StateKey[]).find(
      (k) => !TRANSITIONS.some((t) => t.from === k && t.gate))!;
    expect(projectSummary([makeItem("A-1", ungated)]).gates).toEqual([]);
  });

  it("snapshots sprints: counts and points, committed vs done", () => {
    const wis: WorkItem[] = [
      { id: "W-1", type: "story", title: "a", state: "done", assignee: "S", sprint: "S1", storyPoints: 3 },
      { id: "W-2", type: "task", title: "b", state: "todo", assignee: "S", sprint: "S1", storyPoints: 2 },
      { id: "W-3", type: "task", title: "c", state: "todo", assignee: "S" }, // no sprint — excluded
    ];
    const s = projectSummary([makeItem("A-1", "in_development", wis)]);
    expect(s.sprints).toEqual([{ name: "S1", total: 2, done: 1, points: 5, donePoints: 3 }]);
  });

  it("collects recent activity newest-first, capped", () => {
    const a = makeItem("A-1", "backlog", [], 1000);
    const b = makeItem("A-2", "backlog", [], 2000);
    const s = projectSummary([a, b]);
    expect(s.activity[0]).toMatchObject({ itemId: "A-2", ts: 2000 });
    expect(s.activity[1]).toMatchObject({ itemId: "A-1", ts: 1000 });
  });

  it("totals items and work items", () => {
    const wis: WorkItem[] = [
      { id: "W-1", type: "story", title: "a", state: "done", assignee: "S" },
      { id: "W-2", type: "task", title: "b", state: "todo", assignee: "S" },
    ];
    const s = projectSummary([makeItem("A-1", "backlog", wis)]);
    expect(s.totals).toEqual({ items: 1, workItems: 2, doneWis: 1 });
  });
});
