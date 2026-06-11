/* Pure search helper tests — fixtures are event-sourced via ev() appends,
   exactly like the live system builds items. */
import { describe, it, expect } from "vitest";
import { ev, type Item, type WiPatchWire } from "./engine";
import { matchItems, type SearchHit } from "./search";

/* ---------- fixtures (all state comes from events) ---------- */

function makeItem(id: string, title: string, type: Item["type"] = "feature"): Item {
  return {
    id, title, area: "Payments", priority: "Medium", parent: null, type,
    stakeholders: [], workItems: [],
    events: [ev(id, "CREATE", "Maya Chen", "PM", { to: "backlog" })],
  };
}

function addWi(item: Item, wiId: string, wi: WiPatchWire) {
  item.events.push(ev(item.id, "WI_CREATE", "Maya Chen", "PM", { wiId, wi }));
}

function rows(...items: Item[]): { item: Item }[] {
  return items.map((item) => ({ item }));
}

/** PAY-412 with two work items, tags, comments and a tombstoned WI. */
function fixture(): Item {
  const it = makeItem("PAY-412", "Payment retries");
  addWi(it, "WI-1", {
    type: "story", title: "Checkout flow", state: "in_progress",
    assignee: "Maya Chen", sprint: "Sprint 7", tags: ["payments", "urgent"],
  });
  addWi(it, "WI-2", {
    type: "bug", title: "Login crash", state: "todo", assignee: "Sam Okafor",
  });
  it.events.push(ev(it.id, "ITEM_COMMENT", "Sam Okafor", "Dev", { text: "We need OAuth here" }));
  it.events.push(ev(it.id, "WI_COMMENT", "Maya Chen", "PM", { wiId: "WI-1", text: "blocked on gateway timeout" }));
  // tombstoned work item: created then deleted — must never surface
  addWi(it, "WI-9", { type: "task", title: "Zombie cleanup", state: "todo", assignee: "Maya Chen" });
  it.events.push(ev(it.id, "WI_COMMENT", "Maya Chen", "PM", { wiId: "WI-9", text: "zombie thread" }));
  it.events.push(ev(it.id, "WI_DELETE", "Maya Chen", "PM", { wiId: "WI-9" }));
  return it;
}

const fields = (hits: SearchHit[]) => hits.map((h) => h.field);

describe("matchItems — basic matching", () => {
  it("matches item title case-insensitively (substring)", () => {
    const hits = matchItems(rows(fixture()), "pAyMeNt RET");
    expect(hits).toEqual([{ itemId: "PAY-412", title: "Payment retries", field: "title" }]);
  });

  it("matches item id case-insensitively", () => {
    const hits = matchItems(rows(fixture()), "pay-412");
    expect(hits[0]).toEqual({ itemId: "PAY-412", title: "Payment retries", field: "id" });
  });

  it("matches derived work-item titles and ids", () => {
    const byTitle = matchItems(rows(fixture()), "checkout");
    expect(byTitle).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-1", wiTitle: "Checkout flow", field: "wi_title",
    }]);
    const byId = matchItems(rows(fixture()), "wi-2");
    expect(byId).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-2", wiTitle: "Login crash", field: "id",
    }]);
  });

  it("matches work-item tags", () => {
    const hits = matchItems(rows(fixture()), "urgent");
    expect(hits).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-1", wiTitle: "Checkout flow", field: "wi_tag",
    }]);
  });

  it("matches item comments and WI comments (WI comment carries wiId)", () => {
    const itemComment = matchItems(rows(fixture()), "oauth");
    expect(itemComment).toEqual([{ itemId: "PAY-412", title: "Payment retries", field: "comment" }]);
    const wiComment = matchItems(rows(fixture()), "gateway timeout");
    expect(wiComment).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-1", wiTitle: "Checkout flow", field: "comment",
    }]);
  });

  it("returns nothing for blank or non-matching queries", () => {
    expect(matchItems(rows(fixture()), "   ")).toEqual([]);
    expect(matchItems(rows(fixture()), "does-not-exist-anywhere")).toEqual([]);
  });

  it("emits ONE hit per entity (best field wins, no duplicates)", () => {
    const it1 = makeItem("PAY-9", "PAY-9 hardening"); // q "pay-9" hits id (exact) AND title
    const hits = matchItems(rows(it1), "pay-9");
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe("id");
  });
});

describe("matchItems — tombstoned work items", () => {
  it("excludes deleted WIs: title, and their comment threads", () => {
    expect(matchItems(rows(fixture()), "zombie")).toEqual([]);
    expect(matchItems(rows(fixture()), "wi-9")).toEqual([]);
  });
});

describe("matchItems — ranking & cap", () => {
  it("ranks: id exact > id substring > title > wi_title > wi_tag > comment", () => {
    const a = makeItem("BIL-1", "Pay later support");        // title hit (id must NOT contain "pay")
    addWi(a, "WI-T", { type: "task", title: "payday batch", state: "todo", assignee: "x", tags: ["nonpay"] });
    const b = makeItem("OTH-1", "Other");
    addWi(b, "WI-G", { type: "task", title: "untitled", state: "todo", assignee: "x", tags: ["payments"] });
    b.events.push(ev(b.id, "ITEM_COMMENT", "Maya Chen", "PM", { text: "pay the piper" }));
    const c = makeItem("PAY", "Exact id item");              // id EXACT for q "pay"
    const d = makeItem("PAYX-2", "Substring id item");       // id substring
    const hits = matchItems(rows(a, b, c, d), "pay");
    expect(hits[0]).toMatchObject({ itemId: "PAY", field: "id" });       // exact id first
    expect(hits[1]).toMatchObject({ itemId: "PAYX-2", field: "id" });    // then id substring
    expect(hits[2]).toMatchObject({ itemId: "BIL-1", field: "title" });
    expect(fields(hits)).toEqual(["id", "id", "title", "wi_title", "wi_tag", "comment"]);
  });

  it("caps at 50 results", () => {
    const many = Array.from({ length: 60 }, (_, i) => makeItem(`X-${i}`, `Rollout wave ${i}`));
    expect(matchItems(rows(...many), "rollout")).toHaveLength(50);
  });
});

describe("matchItems — filter tokens (AND with free text)", () => {
  it("assignee:NAME restricts to matching work items", () => {
    const hits = matchItems(rows(fixture()), "assignee:maya");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ wiId: "WI-1", field: "wi_title" });
    // AND with free text: assignee matches but free text doesn't → nothing
    expect(matchItems(rows(fixture()), "assignee:maya login")).toEqual([]);
    // both match
    expect(matchItems(rows(fixture()), "assignee:sam login")).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-2", wiTitle: "Login crash", field: "wi_title",
    }]);
  });

  it("state:STATE filters work items by WI state and items by spine state", () => {
    expect(matchItems(rows(fixture()), "state:todo")).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-2", wiTitle: "Login crash", field: "wi_title",
    }]);
    // the item itself is in backlog
    expect(matchItems(rows(fixture()), "state:backlog payment")).toEqual([{
      itemId: "PAY-412", title: "Payment retries", field: "title",
    }]);
    expect(matchItems(rows(fixture()), "state:monitoring payment")).toEqual([]);
  });

  it("type:TYPE filters by WI type (and item type for item hits)", () => {
    expect(matchItems(rows(fixture()), "type:bug")).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-2", wiTitle: "Login crash", field: "wi_title",
    }]);
    expect(matchItems(rows(fixture()), "type:epic payment")).toEqual([]);
    expect(matchItems(rows(fixture()), "type:feature payment")).toEqual([{
      itemId: "PAY-412", title: "Payment retries", field: "title",
    }]);
  });

  it("sprint:NAME restricts to work items in that sprint", () => {
    expect(matchItems(rows(fixture()), "sprint:7")).toEqual([{
      itemId: "PAY-412", title: "Payment retries", wiId: "WI-1", wiTitle: "Checkout flow", field: "wi_title",
    }]);
    expect(matchItems(rows(fixture()), "sprint:99")).toEqual([]);
  });

  it("filter tokens combine (AND) and values are case-insensitive", () => {
    expect(matchItems(rows(fixture()), "ASSIGNEE:MAYA sprint:7 checkout")).toHaveLength(1);
    expect(matchItems(rows(fixture()), "assignee:maya sprint:99 checkout")).toEqual([]);
    expect(matchItems(rows(fixture()), "assignee:maya state:todo")).toEqual([]); // WI-1 is in_progress
  });

  it("assignee/sprint filters exclude item-level hits (items have neither field)", () => {
    // "retries" only appears in the ITEM title — assignee filter kills the item-level entity
    expect(matchItems(rows(fixture()), "assignee:maya retries")).toEqual([]);
    expect(matchItems(rows(fixture()), "sprint:7 pay-412")).toEqual([]);
  });
});
