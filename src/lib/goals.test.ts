import { describe, it, expect } from "vitest";
import { goalProgress } from "./goals";
import { STATES, type Item, type PdlcEvent, type StateKey } from "./engine";

/* Goal progress — pure fold over member items' spine positions.
   1.0 = every member at/past `released`; off-spine members count as 0. */

function makeItem(id: string, state: StateKey): Item {
  const create: PdlcEvent = { id: id + "-e1", item: id, type: "CREATE", actor: "M", role: "PM", ts: 1, to: state };
  return {
    id, title: id, area: "A", priority: "High", parent: null, type: "feature",
    stakeholders: [], workItems: [], events: [create],
  };
}

describe("goalProgress", () => {
  it("is 0 with no members", () => {
    expect(goalProgress([])).toBe(0);
  });

  it("averages member spine positions against the released spine", () => {
    const released = makeItem("A", "released");           // 1.0
    const backlog = makeItem("B", "backlog");             // 0.0
    expect(goalProgress([released, backlog])).toBeCloseTo(0.5);
    expect(goalProgress([released])).toBe(1);
  });

  it("caps past-released members at 1 and counts off-spine members as 0", () => {
    expect(goalProgress([makeItem("A", "done")])).toBe(1);     // spine 11 > released's 9
    expect(goalProgress([makeItem("B", "rejected")])).toBe(0); // off-spine terminal
    void STATES;
  });

  it("mid-spine members contribute fractionally", () => {
    const dev = makeItem("A", "in_development");
    const p = goalProgress([dev]);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});
