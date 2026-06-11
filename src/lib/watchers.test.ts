/* Engine fold tests for the WATCH_SET event → Snapshot.watchers. */
import { describe, it, expect } from "vitest";
import { deriveItem, type Item, type PdlcEvent } from "./engine";

function makeItem(events: PdlcEvent[]): Item {
  return {
    id: "TEST-1", title: "Test item", area: "Payments", priority: "High",
    parent: null, type: "feature", stakeholders: [], workItems: [], events,
  };
}

let ts = 1000;
function E(type: PdlcEvent["type"], actor: string, payload?: Partial<PdlcEvent>): PdlcEvent {
  return {
    id: "w" + Math.random().toString(36).slice(2),
    item: "TEST-1", type, actor, role: "PM", ts: ++ts, ...payload,
  };
}

describe("deriveItem — WATCH_SET → watchers", () => {
  it("defaults to an empty Set with no watch events", () => {
    const snap = deriveItem(makeItem([E("CREATE", "Maya Chen", { to: "backlog" })]));
    expect(snap.watchers).toBeInstanceOf(Set);
    expect(snap.watchers.size).toBe(0);
  });

  it("on=true adds the ACTOR's name; on=false removes it", () => {
    const item = makeItem([
      E("CREATE", "Maya Chen", { to: "backlog" }),
      E("WATCH_SET", "Maya Chen", { on: true }),
    ]);
    expect([...deriveItem(item).watchers]).toEqual(["Maya Chen"]);

    item.events = [...item.events, E("WATCH_SET", "Maya Chen", { on: false })];
    expect(deriveItem(item).watchers.size).toBe(0);
  });

  it("accumulates multiple watchers and is idempotent per actor", () => {
    const item = makeItem([
      E("CREATE", "Maya Chen", { to: "backlog" }),
      E("WATCH_SET", "Maya Chen", { on: true }),
      E("WATCH_SET", "Sam Okafor", { on: true }),
      E("WATCH_SET", "Maya Chen", { on: true }), // duplicate watch — still one entry
    ]);
    const w = deriveItem(item).watchers;
    expect(w.size).toBe(2);
    expect(w.has("Maya Chen")).toBe(true);
    expect(w.has("Sam Okafor")).toBe(true);
  });

  it("last event wins: unwatch then re-watch restores the watcher", () => {
    const item = makeItem([
      E("CREATE", "Maya Chen", { to: "backlog" }),
      E("WATCH_SET", "Sam Okafor", { on: true }),
      E("WATCH_SET", "Sam Okafor", { on: false }),
      E("WATCH_SET", "Sam Okafor", { on: true }),
    ]);
    expect([...deriveItem(item).watchers]).toEqual(["Sam Okafor"]);
  });

  it("unwatching when not watching is a harmless no-op", () => {
    const item = makeItem([
      E("CREATE", "Maya Chen", { to: "backlog" }),
      E("WATCH_SET", "Sam Okafor", { on: false }),
    ]);
    expect(deriveItem(item).watchers.size).toBe(0);
  });
});
