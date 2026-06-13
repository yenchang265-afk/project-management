/* Pure-function tests for the notification fan-out: @mention parsing and
   recipient planning. DB insertion is covered by the integration test. */
import { describe, it, expect } from "vitest";
import type { Item, PdlcEvent } from "../lib/engine";
import { extractMentions, planNotifications } from "./notify";

const USERS = [
  { id: "u-maya", name: "Maya Chen" },
  { id: "u-sam", name: "Sam Okafor" },
  { id: "u-priya", name: "Priya Patel" },
];
const NAMES = USERS.map((u) => u.name);

describe("extractMentions", () => {
  it("matches a full @Name token case-insensitively", () => {
    expect(extractMentions("ping @maya chen please", NAMES)).toEqual(["Maya Chen"]);
    expect(extractMentions("ping @MAYA CHEN", NAMES)).toEqual(["Maya Chen"]);
  });

  it("requires the @ prefix", () => {
    expect(extractMentions("Maya Chen should look at this", NAMES)).toEqual([]);
  });

  it("does not match inside a longer word (boundary after the name)", () => {
    expect(extractMentions("@Maya Chenoweth", NAMES)).toEqual([]); // not "Maya Chen"
    expect(extractMentions("@Sam", NAMES)).toEqual([]);            // partial name is not a mention
  });

  it("finds multiple distinct mentions, de-duplicated", () => {
    const out = extractMentions("@Maya Chen and @Sam Okafor (cc @maya chen)", NAMES);
    expect(out.sort()).toEqual(["Maya Chen", "Sam Okafor"]);
  });

  it("returns [] for empty text or empty name list", () => {
    expect(extractMentions("", NAMES)).toEqual([]);
    expect(extractMentions("@Maya Chen", [])).toEqual([]);
  });
});

/* ---------- planNotifications ---------- */
let ts = 1000;
function E(type: PdlcEvent["type"], actor: string, payload?: Partial<PdlcEvent>): PdlcEvent {
  return { id: "n" + Math.random().toString(36).slice(2), item: "PAY-412", type, actor, role: "PM", ts: ++ts, ...payload };
}
function makeItem(events: PdlcEvent[]): Item {
  return {
    id: "PAY-412", title: "Apple Pay", area: "Payments", priority: "High",
    parent: null, type: "feature", stakeholders: [], workItems: [], events,
  };
}
// Maya and Sam watch the item.
function watchedItem(): Item {
  return makeItem([
    E("CREATE", "Maya Chen", { to: "backlog" }),
    E("WATCH_SET", "Maya Chen", { on: true }),
    E("WATCH_SET", "Sam Okafor", { on: true }),
  ]);
}

describe("planNotifications", () => {
  it("TRANSITION notifies watchers but never the actor", () => {
    const item = watchedItem();
    const event = E("TRANSITION", "Maya Chen", { from: "backlog", to: "in_discovery" });
    const rows = planNotifications(item, event, USERS);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u-sam");
    expect(rows[0].itemId).toBe("PAY-412");
    expect(rows[0].kind).toBe("transition");
    expect(rows[0].message).toContain("Maya Chen");
    expect(rows[0].message).toContain("PAY-412");
  });

  it("ITEM_COMMENT notifies watchers (kind=comment) and @mentions (kind=mention)", () => {
    const item = watchedItem();
    const event = E("ITEM_COMMENT", "Maya Chen", { text: "thoughts, @Priya Patel?" });
    const rows = planNotifications(item, event, USERS);
    const byUser = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(rows).toHaveLength(2);
    expect(byUser["u-sam"].kind).toBe("comment");     // watcher
    expect(byUser["u-priya"].kind).toBe("mention");   // mentioned, not watching
    expect(byUser["u-maya"]).toBeUndefined();         // actor excluded
  });

  it("a watcher who is also @mentioned gets ONE notification (mention wins)", () => {
    const item = watchedItem();
    const event = E("ITEM_COMMENT", "Maya Chen", { text: "over to you @Sam Okafor" });
    const rows = planNotifications(item, event, USERS);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u-sam");
    expect(rows[0].kind).toBe("mention");
  });

  it("never notifies the actor, even on self-mention while watching", () => {
    const item = watchedItem();
    const event = E("ITEM_COMMENT", "Maya Chen", { text: "note to self @Maya Chen" });
    const rows = planNotifications(item, event, USERS);
    expect(rows.map((r) => r.userId)).toEqual(["u-sam"]); // other watcher still notified
    expect(rows.some((r) => r.userId === "u-maya")).toBe(false);
  });

  it("other event types produce no notifications", () => {
    const item = watchedItem();
    for (const e of [
      E("CONDITION_SATISFY", "Maya Chen", { condition: "spec_approved" }),
      E("WATCH_SET", "Priya Patel", { on: true }),
      E("FLAG_SET", "Maya Chen", { flag: "blocked", value: true, reason: "x" }),
    ])
      expect(planNotifications(item, e, USERS)).toEqual([]);
  });

  it("messages stay within the 300-char DB column", () => {
    const item = watchedItem();
    const event = E("ITEM_COMMENT", "Maya Chen", { text: "@Priya Patel " + "x".repeat(2000) });
    for (const r of planNotifications(item, event, USERS))
      expect(r.message.length).toBeLessThanOrEqual(300);
  });
});

/* ---------- WI_COMMENT: comments on a work item ---------- */
const WI = (id: string, assignee: string) =>
  ({ id, type: "task" as const, title: id, state: "todo" as const, assignee });
function watchedItemWithWi(workItems: ReturnType<typeof WI>[]): Item {
  return { ...watchedItem(), workItems };
}

describe("planNotifications — WI_COMMENT", () => {
  it("notifies the work item's assignee + item watchers + @mentions; excludes the actor", () => {
    const item = watchedItemWithWi([WI("PAY-418", "Priya Patel")]);
    const event = E("WI_COMMENT", "Maya Chen", { wiId: "PAY-418", text: "please review" });
    const rows = planNotifications(item, event, USERS);
    const byUser = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(rows).toHaveLength(2);
    expect(byUser["u-sam"].kind).toBe("comment");    // item watcher
    expect(byUser["u-priya"].kind).toBe("comment");  // WI assignee (not watching)
    expect(byUser["u-maya"]).toBeUndefined();        // actor (also a watcher) excluded
    expect(byUser["u-priya"].message).toContain("PAY-418");
  });

  it("@mention wins over assignee/watcher (one row each)", () => {
    const item = watchedItemWithWi([WI("PAY-418", "Priya Patel")]);
    const event = E("WI_COMMENT", "Maya Chen", { wiId: "PAY-418", text: "over to you @Priya Patel" });
    const rows = planNotifications(item, event, USERS);
    expect(rows.filter((r) => r.userId === "u-priya")).toHaveLength(1);
    expect(rows.find((r) => r.userId === "u-priya")!.kind).toBe("mention");
  });

  it("never notifies the actor even when they are the assignee", () => {
    const item = watchedItemWithWi([WI("PAY-418", "Maya Chen")]);
    const event = E("WI_COMMENT", "Maya Chen", { wiId: "PAY-418", text: "self note" });
    const rows = planNotifications(item, event, USERS);
    expect(rows.some((r) => r.userId === "u-maya")).toBe(false);
    expect(rows.map((r) => r.userId)).toEqual(["u-sam"]); // other watcher still notified
  });

  it("a comment on an unknown work item still notifies watchers + @mentions (no assignee)", () => {
    const item = watchedItem(); // no work items
    const event = E("WI_COMMENT", "Maya Chen", { wiId: "GONE-1", text: "thoughts @Priya Patel?" });
    const rows = planNotifications(item, event, USERS);
    const byUser = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(byUser["u-sam"].kind).toBe("comment");
    expect(byUser["u-priya"].kind).toBe("mention");
  });

  it("messages stay within the 300-char DB column", () => {
    const item = watchedItemWithWi([WI("PAY-418", "Priya Patel")]);
    const event = E("WI_COMMENT", "Maya Chen", { wiId: "PAY-418", text: "x".repeat(2000) });
    for (const r of planNotifications(item, event, USERS))
      expect(r.message.length).toBeLessThanOrEqual(300);
  });
});
