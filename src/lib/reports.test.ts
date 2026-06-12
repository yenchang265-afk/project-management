import { describe, it, expect } from "vitest";
import { ev, type Item, type PdlcEvent, type WorkItem } from "./engine";
import { burndown, velocity, cfd, wiCycleTimes } from "./reports";

/* Fixture helpers — same philosophy as engine.test.ts: build items by
   appending ev(...) events with explicit timestamps. */

const T0 = 1_000_000; // arbitrary epoch base
const H = 3600e3;     // 1 hour

function makeItem(id: string, events: PdlcEvent[], workItems: WorkItem[] = []): Item {
  return {
    id,
    title: "Item " + id,
    area: "Payments",
    priority: "High",
    parent: null,
    type: "feature",
    stakeholders: [],
    workItems,
    events,
  };
}

/** WI event at an explicit ts (ev() spreads the payload, so ts overrides). */
function wiEv(itemId: string, type: PdlcEvent["type"], ts: number, payload: Partial<PdlcEvent>): PdlcEvent {
  return ev(itemId, type, "Maya Chen", "PM", { ts, ...payload });
}

const create = (itemId: string, ts: number, wiId: string, wi: Partial<WorkItem>) =>
  wiEv(itemId, "WI_CREATE", ts, { wiId, wi });
const update = (itemId: string, ts: number, wiId: string, wi: Record<string, unknown>) =>
  wiEv(itemId, "WI_UPDATE", ts, { wiId, wi: wi as PdlcEvent["wi"] });
const del = (itemId: string, ts: number, wiId: string) =>
  wiEv(itemId, "WI_DELETE", ts, { wiId });

/* =================== burndown =================== */

describe("burndown", () => {
  it("returns [] with no items", () => {
    expect(burndown([], "S1")).toEqual([]);
  });

  it("returns [] when no event ever touches the sprint", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "x", state: "todo", assignee: "", sprint: "OTHER" }),
    ]);
    expect(burndown([item], "S1")).toEqual([]);
  });

  it("folds create / transition events into remaining vs total points", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      create("A", T0 + H, "A-101", { type: "story", title: "b", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
      update("A", T0 + 2 * H, "A-100", { state: "done" }),
    ]);
    expect(burndown([item], "S1")).toEqual([
      { ts: T0, remaining: 3, total: 3 },
      { ts: T0 + H, remaining: 5, total: 5 },
      { ts: T0 + 2 * H, remaining: 2, total: 5 },
    ]);
  });

  it("defaults to 1 point when storyPoints is unset", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "task", title: "a", state: "todo", assignee: "", sprint: "S1" }),
    ]);
    expect(burndown([item], "S1")).toEqual([{ ts: T0, remaining: 1, total: 1 }]);
  });

  it("WIs without a sprint are excluded; moving in/out of the sprint changes the picture", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 5 }), // no sprint
      update("A", T0 + H, "A-100", { sprint: "S1" }),           // moved in
      update("A", T0 + 2 * H, "A-100", { sprint: null }),       // moved out (cleared)
    ]);
    expect(burndown([item], "S1")).toEqual([
      { ts: T0 + H, remaining: 5, total: 5 },
      { ts: T0 + 2 * H, remaining: 0, total: 0 },
    ]);
  });

  it("points changed mid-sprint adjust both remaining and total", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      update("A", T0 + H, "A-100", { storyPoints: 8 }),
    ]);
    expect(burndown([item], "S1")).toEqual([
      { ts: T0, remaining: 3, total: 3 },
      { ts: T0 + H, remaining: 8, total: 8 },
    ]);
  });

  it("a deleted (tombstoned) WI drops out of remaining and total", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      create("A", T0 + H, "A-101", { type: "story", title: "b", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
      del("A", T0 + 2 * H, "A-100"),
    ]);
    expect(burndown([item], "S1")).toEqual([
      { ts: T0, remaining: 3, total: 3 },
      { ts: T0 + H, remaining: 5, total: 5 },
      { ts: T0 + 2 * H, remaining: 2, total: 2 },
    ]);
  });

  it("reopening a done WI (done → todo) adds its points back to remaining", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      update("A", T0 + H, "A-100", { state: "done" }),
      update("A", T0 + 2 * H, "A-100", { state: "todo" }),
    ]);
    expect(burndown([item], "S1")).toEqual([
      { ts: T0, remaining: 3, total: 3 },
      { ts: T0 + H, remaining: 0, total: 3 },
      { ts: T0 + 2 * H, remaining: 3, total: 3 },
    ]);
  });

  it("sorts out-of-order event timestamps before folding", () => {
    const item = makeItem("A", [
      update("A", T0 + H, "A-100", { state: "done" }),     // appended first, happens second
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
    ]);
    expect(burndown([item], "S1")).toEqual([
      { ts: T0, remaining: 2, total: 2 },
      { ts: T0 + H, remaining: 0, total: 2 },
    ]);
  });

  it("aggregates across multiple items", () => {
    const a = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
    ]);
    const b = makeItem("B", [
      create("B", T0 + H, "B-100", { type: "story", title: "b", state: "todo", assignee: "", storyPoints: 4, sprint: "S1" }),
    ]);
    expect(burndown([a, b], "S1")).toEqual([
      { ts: T0, remaining: 3, total: 3 },
      { ts: T0 + H, remaining: 7, total: 7 },
    ]);
  });

  it("with a range: first point at range.start (pre-start events folded in), last at range.end", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      update("A", T0 + 2 * H, "A-100", { state: "done" }),
      update("A", T0 + 10 * H, "A-100", { state: "todo" }), // after range.end — ignored
    ]);
    const range = { start: T0 + H, end: T0 + 4 * H };
    expect(burndown([item], "S1", range)).toEqual([
      { ts: T0 + H, remaining: 3, total: 3 },
      { ts: T0 + 2 * H, remaining: 0, total: 3 },
      { ts: T0 + 4 * H, remaining: 0, total: 3 },
    ]);
  });

  it("with a range: baseline workItems (no events) still produce start/end points", () => {
    const item = makeItem("A", [], [
      { id: "A-1", type: "story", title: "seeded", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" },
    ]);
    const range = { start: T0, end: T0 + H };
    expect(burndown([item], "S1", range)).toEqual([
      { ts: T0, remaining: 2, total: 2 },
      { ts: T0 + H, remaining: 2, total: 2 },
    ]);
  });
});

/* =================== velocity =================== */

describe("velocity", () => {
  it("returns zeros for sprints nothing ever touched", () => {
    expect(velocity([], ["S1", "S2"])).toEqual([
      { sprint: "S1", donePoints: 0, committedPoints: 0 },
      { sprint: "S2", donePoints: 0, committedPoints: 0 },
    ]);
  });

  it("committed = points of all WIs ever in the sprint; done = currently done in it", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      create("A", T0 + H, "A-101", { type: "story", title: "b", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
      update("A", T0 + 2 * H, "A-100", { state: "done" }),
      // A-101 gets pushed to the next sprint: still committed to S1, not done in it
      update("A", T0 + 3 * H, "A-101", { sprint: "S2" }),
    ]);
    expect(velocity([item], ["S1", "S2"])).toEqual([
      { sprint: "S1", donePoints: 3, committedPoints: 5 },
      { sprint: "S2", donePoints: 0, committedPoints: 2 },
    ]);
  });

  it("defaults to 1 point when storyPoints is unset", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "task", title: "a", state: "done", assignee: "", sprint: "S1" }),
    ]);
    expect(velocity([item], ["S1"])).toEqual([{ sprint: "S1", donePoints: 1, committedPoints: 1 }]);
  });

  it("a deleted WI still counts as committed but never as done", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "done", assignee: "", storyPoints: 3, sprint: "S1" }),
      del("A", T0 + H, "A-100"),
    ]);
    expect(velocity([item], ["S1"])).toEqual([{ sprint: "S1", donePoints: 0, committedPoints: 3 }]);
  });

  it("a reopened WI stays committed but drops out of done", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "done", assignee: "", storyPoints: 3, sprint: "S1" }),
      update("A", T0 + H, "A-100", { state: "todo" }),
    ]);
    expect(velocity([item], ["S1"])).toEqual([{ sprint: "S1", donePoints: 0, committedPoints: 3 }]);
  });
});

/* =================== cfd =================== */

describe("cfd", () => {
  it("returns [] with no items / no WI events", () => {
    expect(cfd([])).toEqual([]);
    expect(cfd([makeItem("A", [])])).toEqual([]);
  });

  it("samples WI counts per state at each event timestamp", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "" }),
      create("A", T0 + H, "A-101", { type: "task", title: "b", state: "todo", assignee: "" }),
      update("A", T0 + 2 * H, "A-100", { state: "in_progress" }),
      update("A", T0 + 3 * H, "A-100", { state: "done" }),
    ]);
    expect(cfd([item])).toEqual([
      { ts: T0,         counts: { todo: 1, in_progress: 0, in_review: 0, blocked: 0, done: 0 } },
      { ts: T0 + H,     counts: { todo: 2, in_progress: 0, in_review: 0, blocked: 0, done: 0 } },
      { ts: T0 + 2 * H, counts: { todo: 1, in_progress: 1, in_review: 0, blocked: 0, done: 0 } },
      { ts: T0 + 3 * H, counts: { todo: 1, in_progress: 0, in_review: 0, blocked: 0, done: 1 } },
    ]);
  });

  it("tombstoned WIs stop being counted after WI_DELETE", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "" }),
      del("A", T0 + H, "A-100"),
    ]);
    expect(cfd([item])).toEqual([
      { ts: T0,     counts: { todo: 1, in_progress: 0, in_review: 0, blocked: 0, done: 0 } },
      { ts: T0 + H, counts: { todo: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 } },
    ]);
  });

  it("counts baseline workItems from the first sample on", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "" }),
    ], [
      { id: "A-1", type: "task", title: "seeded", state: "in_progress", assignee: "" },
    ]);
    expect(cfd([item])).toEqual([
      { ts: T0, counts: { todo: 1, in_progress: 1, in_review: 0, blocked: 0, done: 0 } },
    ]);
  });

  it("buckets down to <= buckets evenly spaced samples spanning the event range", () => {
    const events: PdlcEvent[] = [];
    for (let i = 0; i < 10; i++)
      events.push(create("A", T0 + i * H, `A-${100 + i}`, { type: "task", title: "t" + i, state: "todo", assignee: "" }));
    const item = makeItem("A", events);
    const out = cfd([item], 4);
    expect(out.length).toBe(4);
    expect(out[0].ts).toBe(T0);
    expect(out[3].ts).toBe(T0 + 9 * H);
    // monotonically non-decreasing sample timestamps
    for (let i = 1; i < out.length; i++) expect(out[i].ts).toBeGreaterThan(out[i - 1].ts);
    // last sample has every WI folded in
    expect(out[3].counts.todo).toBe(10);
  });

  it("sorts out-of-order event timestamps before sampling", () => {
    const item = makeItem("A", [
      update("A", T0 + H, "A-100", { state: "done" }),
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "" }),
    ]);
    expect(cfd([item])).toEqual([
      { ts: T0,     counts: { todo: 1, in_progress: 0, in_review: 0, blocked: 0, done: 0 } },
      { ts: T0 + H, counts: { todo: 0, in_progress: 0, in_review: 0, blocked: 0, done: 1 } },
    ]);
  });
});

/* =================== wiCycleTimes =================== */

describe("wiCycleTimes", () => {
  it("returns [] with no items", () => {
    expect(wiCycleTimes([])).toEqual([]);
  });

  it("first in_progress → latest done per WI", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "Checkout", state: "todo", assignee: "" }),
      update("A", T0 + H, "A-100", { state: "in_progress" }),
      update("A", T0 + 2 * H, "A-100", { state: "in_review" }),
      update("A", T0 + 3 * H, "A-100", { state: "in_progress" }), // back — startTs stays at first entry
      update("A", T0 + 4 * H, "A-100", { state: "done" }),
    ]);
    expect(wiCycleTimes([item])).toEqual([
      { wiId: "A-100", itemId: "A", title: "Checkout", startTs: T0 + H, doneTs: T0 + 4 * H, cycleMs: 3 * H },
    ]);
  });

  it("not started → all nulls; started but unfinished → doneTs/cycleMs null", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "task", title: "a", state: "todo", assignee: "" }),
      create("A", T0, "A-101", { type: "task", title: "b", state: "todo", assignee: "" }),
      update("A", T0 + H, "A-101", { state: "in_progress" }),
    ]);
    expect(wiCycleTimes([item])).toEqual([
      { wiId: "A-100", itemId: "A", title: "a", startTs: null, doneTs: null, cycleMs: null },
      { wiId: "A-101", itemId: "A", title: "b", startTs: T0 + H, doneTs: null, cycleMs: null },
    ]);
  });

  it("a reopened WI (done → todo) is no longer finished; re-done uses the LATEST done ts", () => {
    const events = [
      create("A", T0, "A-100", { type: "bug", title: "flaky", state: "todo", assignee: "" }),
      update("A", T0 + H, "A-100", { state: "in_progress" }),
      update("A", T0 + 2 * H, "A-100", { state: "done" }),
      update("A", T0 + 3 * H, "A-100", { state: "todo" }), // reopened
    ];
    expect(wiCycleTimes([makeItem("A", events)])).toEqual([
      { wiId: "A-100", itemId: "A", title: "flaky", startTs: T0 + H, doneTs: null, cycleMs: null },
    ]);
    const redone = [...events, update("A", T0 + 5 * H, "A-100", { state: "done" })];
    expect(wiCycleTimes([makeItem("A", redone)])).toEqual([
      { wiId: "A-100", itemId: "A", title: "flaky", startTs: T0 + H, doneTs: T0 + 5 * H, cycleMs: 4 * H },
    ]);
  });

  it("tombstoned WIs are excluded; out-of-order timestamps are sorted first", () => {
    const item = makeItem("A", [
      update("A", T0 + 2 * H, "A-100", { state: "done" }),  // appended out of order
      create("A", T0, "A-100", { type: "task", title: "a", state: "todo", assignee: "" }),
      update("A", T0 + H, "A-100", { state: "in_progress" }),
      create("A", T0, "A-101", { type: "task", title: "gone", state: "todo", assignee: "" }),
      del("A", T0 + H, "A-101"),
    ]);
    expect(wiCycleTimes([item])).toEqual([
      { wiId: "A-100", itemId: "A", title: "a", startTs: T0 + H, doneTs: T0 + 2 * H, cycleMs: H },
    ]);
  });

  it("a WI_CREATE born in_progress / done sets startTs / doneTs from the create event", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "task", title: "hot", state: "in_progress", assignee: "" }),
      update("A", T0 + H, "A-100", { state: "done" }),
    ]);
    expect(wiCycleTimes([item])).toEqual([
      { wiId: "A-100", itemId: "A", title: "hot", startTs: T0, doneTs: T0 + H, cycleMs: H },
    ]);
  });
});

/* =================== burnup =================== */
import { burnup } from "./reports";

describe("burnup", () => {
  it("returns [] with no items", () => {
    expect(burnup([], "S1")).toEqual([]);
  });

  it("mirrors burndown: done = total - remaining at every sample", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      create("A", T0 + H, "A-101", { type: "story", title: "b", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
      update("A", T0 + 2 * H, "A-100", { state: "done" }),
    ]);
    expect(burnup([item], "S1")).toEqual([
      { ts: T0, done: 0, total: 3 },
      { ts: T0 + H, done: 0, total: 5 },
      { ts: T0 + 2 * H, done: 3, total: 5 },
      { ts: T0 + 2 * H, done: 3, total: 5 },
    ].filter((p, i, a) => i === 0 || p.ts !== a[i - 1].ts || p.done !== a[i - 1].done || p.total !== a[i - 1].total));
  });

  it("scope growth mid-sprint shows in total while done holds", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
      update("A", T0 + H, "A-100", { state: "done" }),
      create("A", T0 + 2 * H, "A-101", { type: "story", title: "b", state: "todo", assignee: "", storyPoints: 4, sprint: "S1" }),
    ]);
    const series = burnup([item], "S1");
    const last = series[series.length - 1];
    expect(last.done).toBe(2);
    expect(last.total).toBe(6);
  });
});

/* =================== sprint report =================== */

import { sprintReport, createdVsResolved } from "./reports";

describe("sprintReport", () => {
  it("splits a sprint's ever-members into completed / open / spilled", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "done one", state: "todo", assignee: "", storyPoints: 3, sprint: "S1" }),
      create("A", T0 + H, "A-101", { type: "story", title: "open one", state: "todo", assignee: "", storyPoints: 2, sprint: "S1" }),
      create("A", T0 + 2 * H, "A-102", { type: "story", title: "moved out", state: "todo", assignee: "", storyPoints: 5, sprint: "S1" }),
      create("A", T0 + 3 * H, "A-103", { type: "story", title: "never in", state: "todo", assignee: "", sprint: "S2" }),
      update("A", T0 + 4 * H, "A-100", { state: "done" }),
      update("A", T0 + 5 * H, "A-102", { sprint: "S2" }),
    ]);
    const r = sprintReport([item], "S1");
    expect(r.completed.map((w) => w.wiId)).toEqual(["A-100"]);
    expect(r.open.map((w) => w.wiId)).toEqual(["A-101"]);
    expect(r.spilled.map((w) => w.wiId)).toEqual(["A-102"]);
    expect(r.committedPoints).toBe(10); // 3 + 2 + 5 — everything ever in S1
    expect(r.completedPoints).toBe(3);
  });

  it("a deleted WI that was in the sprint counts as spilled", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "task", title: "doomed", state: "todo", assignee: "", storyPoints: 1, sprint: "S1" }),
      del("A", T0 + H, "A-100"),
    ]);
    const r = sprintReport([item], "S1");
    expect(r.spilled.map((w) => w.wiId)).toEqual(["A-100"]);
    expect(r.completed).toEqual([]);
    expect(r.open).toEqual([]);
  });
});

/* =================== created vs resolved =================== */

describe("createdVsResolved", () => {
  it("samples cumulative created and currently-done counts over the event span", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "story", title: "a", state: "todo", assignee: "" }),
      create("A", T0 + H, "A-101", { type: "story", title: "b", state: "todo", assignee: "" }),
      update("A", T0 + 2 * H, "A-100", { state: "done" }),
      update("A", T0 + 3 * H, "A-101", { state: "done" }),
      update("A", T0 + 4 * H, "A-101", { state: "in_progress" }), // reopen drops resolved
    ]);
    const pts = createdVsResolved([item], 100); // enough buckets → one sample per event ts
    expect(pts.map((p) => [p.created, p.resolved])).toEqual([
      [1, 0], [2, 0], [2, 1], [2, 2], [2, 1],
    ]);
  });

  it("a deleted WI leaves both series (net counts)", () => {
    const item = makeItem("A", [
      create("A", T0, "A-100", { type: "task", title: "a", state: "todo", assignee: "" }),
      del("A", T0 + H, "A-100"),
    ]);
    const pts = createdVsResolved([item], 100);
    expect(pts.map((p) => [p.created, p.resolved])).toEqual([[1, 0], [0, 0]]);
  });
});
