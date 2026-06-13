/* Pure tests for the scheduled-automation matcher. The DB-driven executor
   (runScheduledAutomations) is covered by integration tests; here we pin the
   selection logic: a parsed CQL picks the right work items, a null query
   matches all. Parse errors are caught in runScheduledAutomations and recorded
   before scheduledMatches is called, so they never reach this function. */
import { describe, expect, it } from "vitest";
import type { Item, PdlcEvent, WorkItem } from "@/lib/engine";
import { parseCql } from "@/lib/cql";
import { scheduledMatches } from "./automation";

const create = (id: string): PdlcEvent => ({ id: "c-" + id, item: id, type: "CREATE", actor: "x", role: "PM", ts: 1, to: "backlog" });
const wi = (id: string, state: WorkItem["state"]): WorkItem => ({ id, type: "task", title: id, state, assignee: "" });
const item = (id: string, wis: WorkItem[]): Item => ({
  id, title: id, area: "A", priority: "High", parent: null, type: "feature",
  stakeholders: [], workItems: wis, events: [create(id)],
});

const items = [
  item("A", [wi("A1", "todo"), wi("A2", "done")]),
  item("B", [wi("B1", "todo")]),
];

function parse(cql: string) {
  const r = parseCql(cql);
  if (!r.ok) throw new Error(`test CQL parse failed: ${r.error}`);
  return r.query;
}

describe("scheduledMatches", () => {
  it("selects only work items matching the CQL condition", () => {
    expect(scheduledMatches(items, parse("state = todo")).map((m) => m.wiId).sort()).toEqual(["A1", "B1"]);
    expect(scheduledMatches(items, parse("state = done")).map((m) => m.wiId)).toEqual(["A2"]);
  });

  it("matches every work item when there is no condition", () => {
    expect(scheduledMatches(items, null).map((m) => m.wiId).sort()).toEqual(["A1", "A2", "B1"]);
  });

  it("returns itemId alongside wiId", () => {
    expect(scheduledMatches(items, parse("state = done"))[0]).toEqual({ itemId: "A", wiId: "A2" });
  });
});
