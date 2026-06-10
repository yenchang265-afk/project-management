import { describe, it, expect } from "vitest";
import {
  deriveItem, ev,
  createWorkItem, updateWorkItem, deleteWorkItem, nextWorkItemId,
  commentWorkItem, normalizeTags,
  type Item, type PdlcEvent, type WiState, type WiType, type WorkItem,
} from "./engine";

const PM = "Maya Chen";

function baseWi(): WorkItem[] {
  return [
    { id: "PAY-418", type: "story", title: "Render button",   state: "todo",        assignee: "Sam" },
    { id: "PAY-420", type: "task",  title: "Validate session", state: "in_progress", assignee: "Priya" },
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

describe("deriveItem — work-item fold", () => {
  it("preserves the seed baseline when there are no WI events", () => {
    expect(deriveItem(makeItem()).workItems).toEqual(baseWi());
  });

  it("WI_CREATE appends a new work item", () => {
    const e = ev("PAY-412", "WI_CREATE", PM, "PM", {
      wiId: "PAY-430", wi: { type: "bug", title: "Crash", assignee: "Sam", state: "todo" },
    });
    const snap = deriveItem(withEvent(makeItem(), e));
    expect(snap.workItems.find((w) => w.id === "PAY-430")).toMatchObject({
      id: "PAY-430", type: "bug", title: "Crash", assignee: "Sam", state: "todo",
    });
  });

  it("WI_UPDATE patches only the given fields", () => {
    const e = ev("PAY-412", "WI_UPDATE", PM, "PM", { wiId: "PAY-418", wi: { state: "done" } });
    const w = deriveItem(withEvent(makeItem(), e)).workItems.find((x) => x.id === "PAY-418")!;
    expect(w.state).toBe("done");
    expect(w.title).toBe("Render button"); // untouched
  });

  it("WI_DELETE tombstones the work item", () => {
    const e = ev("PAY-412", "WI_DELETE", PM, "PM", { wiId: "PAY-418" });
    const ids = deriveItem(withEvent(makeItem(), e)).workItems.map((w) => w.id);
    expect(ids).not.toContain("PAY-418");
    expect(ids).toContain("PAY-420");
  });

  it("does not mutate the original item's baseline array", () => {
    const item = makeItem();
    const e = ev("PAY-412", "WI_UPDATE", PM, "PM", { wiId: "PAY-418", wi: { state: "done" } });
    deriveItem(withEvent(item, e));
    expect(item.workItems.find((w) => w.id === "PAY-418")!.state).toBe("todo");
  });

  it("folds create → update → delete in order", () => {
    let item = makeItem();
    const c = createWorkItem(item, deriveItem(item), { type: "task", title: "New", assignee: "Sam" }, PM, "PM");
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    item = withEvent(item, c.event);
    const id = c.event.wiId!;
    const u = updateWorkItem(item, deriveItem(item), id, { state: "done" }, PM, "PM");
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    item = withEvent(item, u.event);
    expect(deriveItem(item).workItems.find((w) => w.id === id)!.state).toBe("done");
    const d = deleteWorkItem(item, deriveItem(item), id, PM, "PM");
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    item = withEvent(item, d.event);
    expect(deriveItem(item).workItems.map((w) => w.id)).not.toContain(id);
  });
});

describe("createWorkItem", () => {
  it("rejects an empty / whitespace title", () => {
    const item = makeItem();
    const r = createWorkItem(item, deriveItem(item), { type: "task", title: "   ", assignee: "Sam" }, PM, "PM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/title/i);
  });

  it("generates a unique prefixed id (max suffix + 1)", () => {
    const item = makeItem();
    const r = createWorkItem(item, deriveItem(item), { type: "task", title: "X", assignee: "Sam" }, PM, "PM");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.wiId).toBe("PAY-421"); // max(418, 420) + 1
  });

  it("defaults the new work item's state to todo", () => {
    const item = makeItem();
    const r = createWorkItem(item, deriveItem(item), { type: "task", title: "X", assignee: "Sam" }, PM, "PM");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.wi?.state).toBe("todo");
  });

  it("does not reuse a tombstoned id", () => {
    let item = makeItem();
    const c = createWorkItem(item, deriveItem(item), { type: "task", title: "A", assignee: "Sam" }, PM, "PM");
    if (!c.ok) throw new Error("create failed");
    const firstId = c.event.wiId!; // PAY-421
    item = withEvent(item, c.event);
    const d = deleteWorkItem(item, deriveItem(item), firstId, PM, "PM");
    if (!d.ok) throw new Error("delete failed");
    item = withEvent(item, d.event);
    const c2 = createWorkItem(item, deriveItem(item), { type: "task", title: "B", assignee: "Sam" }, PM, "PM");
    if (!c2.ok) throw new Error("create2 failed");
    expect(c2.event.wiId).not.toBe(firstId);
    expect(c2.event.wiId).toBe("PAY-422");
  });
});

describe("updateWorkItem / deleteWorkItem validation", () => {
  it("updateWorkItem rejects an unknown id", () => {
    const item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-999", { state: "done" }, PM, "PM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PAY-999|unknown|not found/i);
  });

  it("updateWorkItem rejects an empty title in the patch", () => {
    const item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-418", { title: "  " }, PM, "PM");
    expect(r.ok).toBe(false);
  });

  it("deleteWorkItem rejects an unknown id", () => {
    const item = makeItem();
    const r = deleteWorkItem(item, deriveItem(item), "PAY-999", PM, "PM");
    expect(r.ok).toBe(false);
  });
});

describe("nextWorkItemId", () => {
  it("returns PREFIX-(max + 1)", () => {
    const item = makeItem();
    expect(nextWorkItemId(item, deriveItem(item))).toBe("PAY-421");
  });
  it("starts at PREFIX-100 when there are no work items", () => {
    const item = makeItem([], [seedCreate()]);
    expect(nextWorkItemId(item, deriveItem(item))).toBe("PAY-100");
  });
});

/* ---- review fixes (adversarial review, 2026-06-09) ---- */
describe("nextWorkItemId — never reuses a deleted baseline id (finding 1)", () => {
  it("stays monotonic after deleting the highest baseline (seed) work item", () => {
    const baseline: WorkItem[] = [
      { id: "PAY-418", type: "story", title: "a", state: "todo", assignee: "Sam" },
      { id: "PAY-423", type: "bug",   title: "b", state: "todo", assignee: "Sam" },
    ];
    let item = makeItem(baseline);
    const d = deleteWorkItem(item, deriveItem(item), "PAY-423", PM, "PM");
    if (!d.ok) throw new Error("delete failed");
    item = withEvent(item, d.event);
    // 423 is gone from the snapshot, but its number must not be recycled
    expect(nextWorkItemId(item, deriveItem(item))).toBe("PAY-424");
    const c = createWorkItem(item, deriveItem(item), { type: "task", title: "c", assignee: "Sam" }, PM, "PM");
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.event.wiId).toBe("PAY-424");
  });
});

describe("updateWorkItem — no contentless events (finding 4)", () => {
  it("rejects an empty patch", () => {
    const item = makeItem();
    expect(updateWorkItem(item, deriveItem(item), "PAY-418", {}, PM, "PM").ok).toBe(false);
  });
  it("rejects a no-op patch (all values unchanged)", () => {
    const item = makeItem();
    const cur = deriveItem(item).workItems.find((w) => w.id === "PAY-418")!;
    const r = updateWorkItem(item, deriveItem(item), "PAY-418",
      { title: cur.title, state: cur.state, type: cur.type, assignee: cur.assignee }, PM, "PM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no chang/i);
  });
  it("emits only the changed fields", () => {
    const item = makeItem();
    // PAY-418 baseline: story / "Render button" / todo / Sam — only state differs
    const r = updateWorkItem(item, deriveItem(item), "PAY-418",
      { type: "story", title: "Render button", state: "done", assignee: "Sam" }, PM, "PM");
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.event.wi || {})).toEqual(["state"]);
  });
});

describe("enum validation at the boundary (finding 5)", () => {
  it("createWorkItem rejects an invalid type", () => {
    const item = makeItem();
    const r = createWorkItem(item, deriveItem(item), { type: "GARBAGE" as WiType, title: "x", assignee: "Sam" }, PM, "PM");
    expect(r.ok).toBe(false);
  });
  it("updateWorkItem rejects an invalid state", () => {
    const item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-418", { state: "NONSENSE" as WiState }, PM, "PM");
    expect(r.ok).toBe(false);
  });
});

/* ---- detail fields + discussion (Azure DevOps-style) ---- */
describe("detail fields — scalar patches via WI_UPDATE", () => {
  it("patches description through the existing update path", () => {
    const item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-418", { description: "Implement the sheet" }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = deriveItem(withEvent(item, r.event)).workItems.find((x) => x.id === "PAY-418")!;
    expect(w.description).toBe("Implement the sheet");
  });

  it("accepts a valid priority and story points; rejects out-of-range / negative", () => {
    const item = makeItem();
    const snap = deriveItem(item);
    expect(updateWorkItem(item, snap, "PAY-418", { priority: 2 }, PM, "PM").ok).toBe(true);
    expect(updateWorkItem(item, snap, "PAY-418", { storyPoints: 0 }, PM, "PM").ok).toBe(true);
    expect(updateWorkItem(item, snap, "PAY-418", { storyPoints: 8 }, PM, "PM").ok).toBe(true);
    expect(updateWorkItem(item, snap, "PAY-418", { priority: 5 as 4 }, PM, "PM").ok).toBe(false);
    expect(updateWorkItem(item, snap, "PAY-418", { storyPoints: -1 }, PM, "PM").ok).toBe(false);
    expect(updateWorkItem(item, snap, "PAY-418", { storyPoints: NaN }, PM, "PM").ok).toBe(false);
  });

  it("rejects an out-of-range severity", () => {
    const item = makeItem();
    expect(updateWorkItem(item, deriveItem(item), "PAY-418", { severity: 9 as 4 }, PM, "PM").ok).toBe(false);
  });

  it("WI_CREATE carries the optional detail fields into the snapshot", () => {
    const e = ev("PAY-412", "WI_CREATE", PM, "PM", {
      wiId: "PAY-430",
      wi: { type: "task", title: "t", assignee: "Sam", description: "d", tags: ["a", "b"], priority: 2, storyPoints: 5, severity: 1 },
    });
    const w = deriveItem(withEvent(makeItem(), e)).workItems.find((x) => x.id === "PAY-430")!;
    expect(w).toMatchObject({ description: "d", tags: ["a", "b"], priority: 2, storyPoints: 5, severity: 1 });
  });
});

describe("tags", () => {
  it("normalizeTags trims, drops empties, de-dupes, preserves order", () => {
    expect(normalizeTags(["  a ", "a", "", "b", "  ", "B"])).toEqual(["a", "b", "B"]);
  });
  it("a real tag change emits an event; an equivalent set is a no-op", () => {
    const item = makeItem();
    const r = updateWorkItem(item, deriveItem(item), "PAY-418", { tags: ["ios", "payments"] }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.wi?.tags).toEqual(["ios", "payments"]);
    const item2 = withEvent(item, r.event);
    // setting the same tags (with noise) again -> normalized-equal -> no event
    const r2 = updateWorkItem(item2, deriveItem(item2), "PAY-418", { tags: [" ios ", "payments", "ios"] }, PM, "PM");
    expect(r2.ok).toBe(false);
  });
});

describe("discussion (WI_COMMENT)", () => {
  it("rejects an empty comment and an unknown id", () => {
    const item = makeItem();
    const snap = deriveItem(item);
    expect(commentWorkItem(item, snap, "PAY-418", "   ", PM, "PM").ok).toBe(false);
    expect(commentWorkItem(item, snap, "PAY-999", "hi", PM, "PM").ok).toBe(false);
  });
  it("appends comments to the work item in chronological order", () => {
    let item = makeItem();
    const c1 = commentWorkItem(item, deriveItem(item), "PAY-418", "first", PM, "PM");
    if (!c1.ok) throw new Error("c1 failed");
    item = withEvent(item, c1.event);
    const c2 = commentWorkItem(item, deriveItem(item), "PAY-418", "  second  ", "Sam Okafor", "Dev");
    if (!c2.ok) throw new Error("c2 failed");
    item = withEvent(item, c2.event);

    const w = deriveItem(item).workItems.find((x) => x.id === "PAY-418")!;
    expect((w.comments || []).map((c) => c.text)).toEqual(["first", "second"]); // trimmed + ordered
    expect(w.comments![1]).toMatchObject({ author: "Sam Okafor", role: "Dev" });
  });
  it("leaves comment-less items without a comments field (baseline shape preserved)", () => {
    const w = deriveItem(makeItem()).workItems.find((x) => x.id === "PAY-420")!;
    expect(w.comments).toBeUndefined();
  });
});

/* ---- review round 2 fixes ---- */
describe("clearing optional scalars (review)", () => {
  it("can clear a set priority back to unset", () => {
    let item = makeItem();
    const set = updateWorkItem(item, deriveItem(item), "PAY-418", { priority: 2 }, PM, "PM");
    if (!set.ok) throw new Error("set failed");
    item = withEvent(item, set.event);
    expect(deriveItem(item).workItems.find((w) => w.id === "PAY-418")!.priority).toBe(2);
    const clear = updateWorkItem(item, deriveItem(item), "PAY-418", { priority: undefined }, PM, "PM");
    expect(clear.ok).toBe(true);
    if (!clear.ok) return;
    item = withEvent(item, clear.event);
    expect(deriveItem(item).workItems.find((w) => w.id === "PAY-418")!.priority).toBeUndefined();
  });
  it("clearing an already-unset scalar is a no-op", () => {
    const item = makeItem();
    expect(updateWorkItem(item, deriveItem(item), "PAY-418", { priority: undefined }, PM, "PM").ok).toBe(false);
    expect(updateWorkItem(item, deriveItem(item), "PAY-418", { storyPoints: undefined }, PM, "PM").ok).toBe(false);
  });
});

describe("WI_CREATE tag hygiene (review)", () => {
  it("normalizes tags supplied on create and isolates them from the event payload", () => {
    const raw = ["  a ", "a", "", "b"];
    const e = ev("PAY-412", "WI_CREATE", PM, "PM", { wiId: "PAY-430", wi: { type: "task", title: "t", assignee: "x", tags: raw } });
    const w = deriveItem(withEvent(makeItem(), e)).workItems.find((x) => x.id === "PAY-430")!;
    expect(w.tags).toEqual(["a", "b"]);
    expect(w.tags).not.toBe(raw); // fresh array, not aliasing the event payload
  });
});
