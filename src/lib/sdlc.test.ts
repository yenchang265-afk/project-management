import { describe, it, expect } from "vitest";
import {
  deriveItem, ev,
  createWorkItem, updateWorkItem,
  legalWiMoves, transitionWorkItem, wiFlow,
  linkWorkItems, unlinkWorkItems, wiBlockedBy,
  reorderWorkItem,
  type Item, type PdlcEvent, type WorkItem,
} from "./engine";

const PM = "Maya Chen";
const DEV = "Sam Okafor";

function baseWi(): WorkItem[] {
  return [
    { id: "PAY-418", type: "story", title: "Render button", state: "todo", assignee: "Sam", phase: "build" },
    { id: "PAY-420", type: "task", title: "Validate session", state: "in_progress", assignee: "Priya", phase: "build" },
    { id: "PAY-421", type: "bug", title: "Sheet flickers", state: "done", assignee: "Sam", phase: "verify" },
  ];
}
function seedCreate(): PdlcEvent {
  return { id: "seed-c", item: "PAY-412", type: "CREATE", actor: PM, role: "PM", ts: 1000, to: "backlog" };
}
function makeItem(workItems: WorkItem[] = baseWi(), events: PdlcEvent[] = [seedCreate()]): Item {
  return {
    id: "PAY-412", title: "Apple Pay", area: "Payments", priority: "High",
    parent: null, type: "feature", stakeholders: [], workItems, events,
  };
}
function withEvent(item: Item, e: PdlcEvent): Item {
  return { ...item, events: [...item.events, e] };
}

/* ---------------- WI workflow (per-type state machines) ---------------- */
describe("work-item workflow tables", () => {
  it("base flow: todo can only start", () => {
    expect(wiFlow("story").todo).toEqual(["in_progress"]);
  });

  it("story reopens done → todo; bug reopens done → in_progress", () => {
    expect(wiFlow("story").done).toEqual(["todo"]);
    expect(wiFlow("bug").done).toEqual(["in_progress"]);
  });

  it("legalWiMoves reads the work item's own type + state", () => {
    const wi: WorkItem = { id: "X-1", type: "bug", title: "b", state: "done", assignee: "" };
    expect(legalWiMoves(wi)).toEqual(["in_progress"]);
  });

  it("transitionWorkItem allows a legal move and emits a state-only WI_UPDATE", () => {
    const item = makeItem();
    const r = transitionWorkItem(item, deriveItem(item), "PAY-418", "in_progress", DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("WI_UPDATE");
    expect(r.event.wi).toEqual({ state: "in_progress" });
    const snap = deriveItem(withEvent(item, r.event));
    expect(snap.workItems.find((w) => w.id === "PAY-418")!.state).toBe("in_progress");
  });

  it("transitionWorkItem rejects an illegal move", () => {
    const item = makeItem();
    const r = transitionWorkItem(item, deriveItem(item), "PAY-418", "done", DEV, "Dev");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/can.t move/i);
  });

  it("transitionWorkItem rejects unknown work item and no-op moves", () => {
    const item = makeItem();
    const snap = deriveItem(item);
    expect(transitionWorkItem(item, snap, "PAY-999", "in_progress", DEV, "Dev").ok).toBe(false);
    expect(transitionWorkItem(item, snap, "PAY-418", "todo", DEV, "Dev").ok).toBe(false);
  });
});

/* ---------------- phase binding ---------------- */
describe("work-item phase binding", () => {
  it("createWorkItem carries an optional phase", () => {
    const item = makeItem();
    const r = createWorkItem(item, deriveItem(item), { type: "task", title: "Spike", assignee: "", phase: "discovery" }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = deriveItem(withEvent(item, r.event));
    expect(snap.workItems.find((w) => w.id === r.event.wiId)!.phase).toBe("discovery");
  });

  it("updateWorkItem validates phase", () => {
    const item = makeItem();
    const snap = deriveItem(item);
    const bad = updateWorkItem(item, snap, "PAY-418", { phase: "shipping" as never }, PM, "PM");
    expect(bad.ok).toBe(false);
    const good = updateWorkItem(item, snap, "PAY-418", { phase: "verify" }, PM, "PM");
    expect(good.ok).toBe(true);
  });

  it("phase can be cleared with an explicit undefined", () => {
    const item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-418", { phase: undefined }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = deriveItem(withEvent(item, r.event));
    expect(snap.workItems.find((w) => w.id === "PAY-418")!.phase).toBeUndefined();
  });
});

/* ---------------- rollup: work_complete release condition ---------------- */
describe("work_complete rollup condition", () => {
  it("stays required while any work item is open", () => {
    expect(deriveItem(makeItem()).conditions.work_complete).toBe("required");
  });

  it("auto-satisfies when every work item is done", () => {
    const all = baseWi().map((w) => ({ ...w, state: "done" as const }));
    expect(deriveItem(makeItem(all)).conditions.work_complete).toBe("satisfied");
  });

  it("vacuously satisfied with zero work items", () => {
    expect(deriveItem(makeItem([])).conditions.work_complete).toBe("satisfied");
  });

  it("reverts to required when a work item reopens", () => {
    const all = baseWi().map((w) => ({ ...w, state: "done" as const }));
    let item = makeItem(all);
    expect(deriveItem(item).conditions.work_complete).toBe("satisfied");
    item = withEvent(item, ev("PAY-412", "WI_UPDATE", DEV, "Dev", { wiId: "PAY-418", wi: { state: "todo" } }));
    expect(deriveItem(item).conditions.work_complete).toBe("required");
  });

  it("an explicit waive sticks even with open work items", () => {
    let item = makeItem();
    item = withEvent(item, ev("PAY-412", "CONDITION_WAIVE", PM, "PM", { condition: "work_complete" }));
    expect(deriveItem(item).conditions.work_complete).toBe("waived");
  });
});

/* ---------------- links ---------------- */
describe("work-item links", () => {
  it("link appends to the source work item", () => {
    const item = makeItem();
    const r = linkWorkItems(item, deriveItem(item), "PAY-418", "blocks", "PAY-420", DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = deriveItem(withEvent(item, r.event));
    expect(snap.workItems.find((w) => w.id === "PAY-418")!.links).toEqual([{ type: "blocks", target: "PAY-420" }]);
  });

  it("rejects self-links, unknown ends, duplicates", () => {
    let item = makeItem();
    const snap = deriveItem(item);
    expect(linkWorkItems(item, snap, "PAY-418", "blocks", "PAY-418", DEV, "Dev").ok).toBe(false);
    expect(linkWorkItems(item, snap, "PAY-418", "blocks", "PAY-999", DEV, "Dev").ok).toBe(false);
    expect(linkWorkItems(item, snap, "PAY-999", "blocks", "PAY-418", DEV, "Dev").ok).toBe(false);
    const r = linkWorkItems(item, snap, "PAY-418", "blocks", "PAY-420", DEV, "Dev");
    if (!r.ok) return;
    item = withEvent(item, r.event);
    expect(linkWorkItems(item, deriveItem(item), "PAY-418", "blocks", "PAY-420", DEV, "Dev").ok).toBe(false);
  });

  it("symmetric types (relates) reject the inverse duplicate too", () => {
    let item = makeItem();
    const r = linkWorkItems(item, deriveItem(item), "PAY-418", "relates", "PAY-420", DEV, "Dev");
    if (!r.ok) return;
    item = withEvent(item, r.event);
    expect(linkWorkItems(item, deriveItem(item), "PAY-420", "relates", "PAY-418", DEV, "Dev").ok).toBe(false);
  });

  it("unlink removes; dangling links to deleted targets are dropped", () => {
    let item = makeItem();
    const r = linkWorkItems(item, deriveItem(item), "PAY-418", "blocks", "PAY-420", DEV, "Dev");
    if (!r.ok) return;
    item = withEvent(item, r.event);
    const u = unlinkWorkItems(item, deriveItem(item), "PAY-418", "blocks", "PAY-420", DEV, "Dev");
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    item = withEvent(item, u.event);
    expect(deriveItem(item).workItems.find((w) => w.id === "PAY-418")!.links ?? []).toEqual([]);

    // re-link then delete the target → link must not survive derivation
    const r2 = linkWorkItems(item, deriveItem(item), "PAY-418", "blocks", "PAY-421", DEV, "Dev");
    if (!r2.ok) return;
    item = withEvent(item, r2.event);
    item = withEvent(item, ev("PAY-412", "WI_DELETE", DEV, "Dev", { wiId: "PAY-421" }));
    const snap = deriveItem(item);
    expect(snap.workItems.find((w) => w.id === "PAY-418")!.links ?? []).toEqual([]);
  });

  it("wiBlockedBy lists open blockers only, and gates the move to done", () => {
    let item = makeItem();
    // PAY-420 blocks PAY-418; PAY-420 is in_progress (open)
    const r = linkWorkItems(item, deriveItem(item), "PAY-420", "blocks", "PAY-418", DEV, "Dev");
    if (!r.ok) return;
    item = withEvent(item, r.event);
    expect(wiBlockedBy(deriveItem(item), "PAY-418")).toEqual(["PAY-420"]);

    // walk PAY-418 to the edge of done: todo → in_progress → in_review
    for (const s of ["in_progress", "in_review"] as const) {
      const t = transitionWorkItem(item, deriveItem(item), "PAY-418", s, DEV, "Dev");
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      item = withEvent(item, t.event);
    }
    const blockedMove = transitionWorkItem(item, deriveItem(item), "PAY-418", "done", DEV, "Dev");
    expect(blockedMove.ok).toBe(false);
    if (blockedMove.ok) return;
    expect(blockedMove.error).toContain("PAY-420");

    // finish the blocker → move proceeds
    for (const s of ["in_review", "done"] as const) {
      const t = transitionWorkItem(item, deriveItem(item), "PAY-420", s, DEV, "Dev");
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      item = withEvent(item, t.event);
    }
    expect(wiBlockedBy(deriveItem(item), "PAY-418")).toEqual([]);
    expect(transitionWorkItem(item, deriveItem(item), "PAY-418", "done", DEV, "Dev").ok).toBe(true);
  });
});

/* ---------------- ranking ---------------- */
describe("work-item ranking", () => {
  it("reorder moves an item to the target index", () => {
    const item = makeItem();
    const r = reorderWorkItem(item, deriveItem(item), "PAY-421", 0, DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("WI_REORDER");
    const snap = deriveItem(withEvent(item, r.event));
    expect(snap.workItems.map((w) => w.id)).toEqual(["PAY-421", "PAY-418", "PAY-420"]);
  });

  it("rejects unknown ids and no-op reorders; clamps out-of-range index", () => {
    const item = makeItem();
    const snap = deriveItem(item);
    expect(reorderWorkItem(item, snap, "PAY-999", 0, DEV, "Dev").ok).toBe(false);
    expect(reorderWorkItem(item, snap, "PAY-418", 0, DEV, "Dev").ok).toBe(false); // already first
    const r = reorderWorkItem(item, snap, "PAY-418", 99, DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = deriveItem(withEvent(item, r.event));
    expect(after.workItems.map((w) => w.id)).toEqual(["PAY-420", "PAY-421", "PAY-418"]);
  });

  it("work items created after a reorder append at the end", () => {
    let item = makeItem();
    const r = reorderWorkItem(item, deriveItem(item), "PAY-421", 0, DEV, "Dev");
    if (!r.ok) return;
    item = withEvent(item, r.event);
    const c = createWorkItem(item, deriveItem(item), { type: "task", title: "Late", assignee: "" }, PM, "PM");
    if (!c.ok) return;
    item = withEvent(item, c.event);
    const ids = deriveItem(item).workItems.map((w) => w.id);
    expect(ids).toEqual(["PAY-421", "PAY-418", "PAY-420", c.event.wiId]);
  });
});

/* ---------------- sprint field ---------------- */
describe("work-item sprint", () => {
  it("sets, trims, and clears the sprint", () => {
    let item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-418", { sprint: "  Sprint 12  " }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    item = withEvent(item, r.event);
    expect(deriveItem(item).workItems.find((w) => w.id === "PAY-418")!.sprint).toBe("Sprint 12");

    const c = updateWorkItem(item, deriveItem(item), "PAY-418", { sprint: undefined }, PM, "PM");
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    item = withEvent(item, c.event);
    expect(deriveItem(item).workItems.find((w) => w.id === "PAY-418")!.sprint).toBeUndefined();
  });
});
