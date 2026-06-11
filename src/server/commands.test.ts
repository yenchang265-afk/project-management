import { describe, it, expect } from "vitest";
import type { Item, PdlcEvent, WorkItem } from "../lib/engine";
import { deriveItem } from "../lib/engine";
import { CommandRequestSchema, CommandSchema, runCommand, type Command } from "./commands";

const PM = "Maya Chen";
const DEV = "Sam Okafor";

function seedCreate(): PdlcEvent {
  return { id: "seed-c", item: "PAY-412", type: "CREATE", actor: PM, role: "PM", ts: 1000, to: "backlog" };
}
function makeItem(workItems: WorkItem[] = [], events: PdlcEvent[] = [seedCreate()]): Item {
  return {
    id: "PAY-412", title: "Apple Pay", area: "Payments", priority: "High",
    parent: null, type: "feature", stakeholders: [], workItems, events,
  };
}
const WI: WorkItem = { id: "PAY-418", type: "story", title: "Button", state: "todo", assignee: "Sam" };

describe("CommandSchema", () => {
  it("accepts every command kind", () => {
    const cmds: Command[] = [
      { kind: "transition", to: "in_discovery", reason: null },
      { kind: "condition", op: "satisfy", key: "spec_approved" },
      { kind: "signoff", gate: "ready_for_dev" },
      { kind: "shiftLeft", risk: "touches_pii", value: true },
      { kind: "subtrack", track: "security", to: "in_review" },
      { kind: "flag", flag: "blocked", value: true, reason: "waiting" },
      { kind: "wiCreate", draft: { type: "task", title: "T", assignee: "" } },
      { kind: "wiUpdate", wiId: "PAY-418", patch: { title: "New" } },
      { kind: "wiDelete", wiId: "PAY-418" },
      { kind: "wiComment", wiId: "PAY-418", text: "hi" },
      { kind: "wiMove", wiId: "PAY-418", to: "in_progress" },
      { kind: "wiLink", wiId: "PAY-418", type: "blocks", target: "PAY-419" },
      { kind: "wiUnlink", wiId: "PAY-418", type: "blocks", target: "PAY-419" },
      { kind: "wiReorder", wiId: "PAY-418", toIndex: 0 },
    ];
    for (const c of cmds) expect(CommandSchema.safeParse(c).success, c.kind).toBe(true);
  });

  it("rejects unknown kinds, extra keys, bad enums", () => {
    expect(CommandSchema.safeParse({ kind: "dropTables" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "transition", to: "in_discovery", reason: null, extra: 1 }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "transition", to: "nope", reason: null }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "wiUpdate", wiId: "X", patch: { id: "evil" } }).success).toBe(false);
  });

  it("request schema requires expectedVersion", () => {
    expect(CommandRequestSchema.safeParse({ command: { kind: "wiDelete", wiId: "X" } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ command: { kind: "wiDelete", wiId: "X" }, expectedVersion: 3 }).success).toBe(true);
  });
});

describe("runCommand — engine + role guards", () => {
  it("transition runs the engine (legal + illegal)", () => {
    const item = makeItem();
    const ok = runCommand(item, { kind: "transition", to: "in_discovery", reason: null }, PM, "PM");
    expect(ok.ok).toBe(true);
    const bad = runCommand(item, { kind: "transition", to: "released", reason: null }, PM, "PM");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.rejection?.type).toBe("ILLEGAL_TRANSITION");
  });

  it("role guard on transitions comes from the engine", () => {
    const item = makeItem();
    const r = runCommand(item, { kind: "transition", to: "in_discovery", reason: null }, DEV, "Dev");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection?.type).toBe("ROLE_GUARD");
  });

  it("condition ops enforce the owner role", () => {
    const item = makeItem();
    expect(runCommand(item, { kind: "condition", op: "satisfy", key: "spec_approved" }, DEV, "Dev").ok).toBe(false);
    expect(runCommand(item, { kind: "condition", op: "satisfy", key: "spec_approved" }, PM, "PM").ok).toBe(true);
    expect(runCommand(item, { kind: "condition", op: "satisfy", key: "nope" }, PM, "PM").ok).toBe(false);
  });

  it("shiftLeft is PM-only", () => {
    const item = makeItem();
    expect(runCommand(item, { kind: "shiftLeft", risk: "touches_pii", value: true }, DEV, "Dev").ok).toBe(false);
    expect(runCommand(item, { kind: "shiftLeft", risk: "touches_pii", value: true }, PM, "PM").ok).toBe(true);
  });

  it("subtrack enforces owner role AND legal flow", () => {
    const item = makeItem();
    expect(runCommand(item, { kind: "subtrack", track: "security", to: "in_review" }, PM, "PM").ok).toBe(false);   // wrong role
    expect(runCommand(item, { kind: "subtrack", track: "security", to: "approved" }, DEV, "Dev").ok).toBe(false);  // illegal jump
    expect(runCommand(item, { kind: "subtrack", track: "security", to: "in_review" }, DEV, "Dev").ok).toBe(true);
  });

  it("wiMove goes through the flow-checked engine transition", () => {
    const item = makeItem([WI]);
    expect(runCommand(item, { kind: "wiMove", wiId: "PAY-418", to: "done" }, DEV, "Dev").ok).toBe(false);
    const r = runCommand(item, { kind: "wiMove", wiId: "PAY-418", to: "in_progress" }, DEV, "Dev");
    expect(r.ok).toBe(true);
  });

  it("wiUpdate null means clear (wire convention → engine convention)", () => {
    const item = makeItem([{ ...WI, priority: 2 }]);
    const r = runCommand(item, { kind: "wiUpdate", wiId: "PAY-418", patch: { priority: null } }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = deriveItem({ ...item, events: [...item.events, r.event] });
    expect(after.workItems.find((w) => w.id === "PAY-418")!.priority).toBeUndefined();
  });

  it("flag allows both roles", () => {
    const item = makeItem();
    expect(runCommand(item, { kind: "flag", flag: "blocked", value: true, reason: "x" }, DEV, "Dev").ok).toBe(true);
    expect(runCommand(item, { kind: "flag", flag: "on_hold", value: true, reason: null }, PM, "PM").ok).toBe(true);
  });
});

describe("item_comment — comments on spine items", () => {
  it("schema accepts 1..2000 character text", () => {
    expect(CommandSchema.safeParse({ kind: "item_comment", text: "hi" }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "item_comment", text: "x".repeat(2000) }).success).toBe(true);
  });

  it("schema rejects empty, too-long, missing text and extra keys", () => {
    expect(CommandSchema.safeParse({ kind: "item_comment", text: "" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_comment", text: "x".repeat(2001) }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_comment" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_comment", text: "hi", wiId: "PAY-418" }).success).toBe(false);
  });

  it("runCommand emits an ITEM_COMMENT event carrying session actor/role and trimmed text", () => {
    const item = makeItem();
    const r = runCommand(item, { kind: "item_comment", text: "  ship it  " }, DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("ITEM_COMMENT");
    expect(r.event.item).toBe("PAY-412");
    expect(r.event.text).toBe("ship it");
    expect(r.event.actor).toBe(DEV);
    expect(r.event.role).toBe("Dev");
    const after = deriveItem({ ...item, events: [...item.events, r.event] });
    expect(after.comments.map((c) => ({ author: c.author, role: c.role, text: c.text })))
      .toEqual([{ author: DEV, role: "Dev", text: "ship it" }]);
  });

  it("runCommand rejects whitespace-only text with {ok:false}", () => {
    const r = runCommand(makeItem(), { kind: "item_comment", text: "   " }, PM, "PM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it("both roles may comment", () => {
    const item = makeItem();
    expect(runCommand(item, { kind: "item_comment", text: "pm note" }, PM, "PM").ok).toBe(true);
    expect(runCommand(item, { kind: "item_comment", text: "dev note" }, DEV, "Dev").ok).toBe(true);
  });
});

describe("watch command", () => {
  it("schema accepts {kind:'watch', on:boolean} and rejects extras / bad shapes", () => {
    expect(CommandSchema.safeParse({ kind: "watch", on: true }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "watch", on: false }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "watch" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "watch", on: "yes" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "watch", on: true, extra: 1 }).success).toBe(false);
  });

  it("runCommand emits WATCH_SET carrying the session actor and the on flag", () => {
    const item = makeItem();
    const r = runCommand(item, { kind: "watch", on: true }, DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("WATCH_SET");
    expect(r.event.item).toBe("PAY-412");
    expect(r.event.on).toBe(true);
    expect(r.event.actor).toBe(DEV);
    const after = deriveItem({ ...item, events: [...item.events, r.event] });
    expect(after.watchers.has(DEV)).toBe(true);
  });

  it("both roles may watch and unwatch (round-trips through the fold)", () => {
    const item = makeItem();
    const on = runCommand(item, { kind: "watch", on: true }, PM, "PM");
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const watched = { ...item, events: [...item.events, on.event] };
    const off = runCommand(watched, { kind: "watch", on: false }, PM, "PM");
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    const after = deriveItem({ ...watched, events: [...watched.events, off.event] });
    expect(after.watchers.has(PM)).toBe(false);
  });
});

describe("item link commands", () => {
  it("schema accepts item_link / item_unlink and rejects bad shapes", () => {
    expect(CommandSchema.safeParse({ kind: "item_link", to: "PAY-413", linkKind: "blocks" }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "item_link", to: "PAY-413", linkKind: "relates" }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "item_unlink", to: "PAY-413", linkKind: "duplicates" }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "item_link", to: "PAY-413", linkKind: "nope" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_link", to: "", linkKind: "blocks" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_link", linkKind: "blocks" }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_link", to: "PAY-413", linkKind: "blocks", extra: 1 }).success).toBe(false);
    expect(CommandSchema.safeParse({ kind: "item_unlink", to: "PAY-413" }).success).toBe(false);
  });

  it("item_link emits ITEM_LINK and folds into snap.links", () => {
    const item = makeItem();
    const r = runCommand(item, { kind: "item_link", to: "PAY-413", linkKind: "blocks" }, PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("ITEM_LINK");
    expect(r.event.item).toBe("PAY-412");
    expect(r.event.to).toBe("PAY-413");
    expect(r.event.linkKind).toBe("blocks");
    const after = deriveItem({ ...item, events: [...item.events, r.event] });
    expect(after.links).toEqual([{ to: "PAY-413", linkKind: "blocks" }]);
  });

  it("rejects a self-link with {ok:false}", () => {
    const r = runCommand(makeItem(), { kind: "item_link", to: "PAY-412", linkKind: "relates" }, PM, "PM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/itself/i);
  });

  it("rejects a duplicate {to, linkKind} link", () => {
    const item = makeItem();
    const first = runCommand(item, { kind: "item_link", to: "PAY-413", linkKind: "blocks" }, PM, "PM");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const linked = { ...item, events: [...item.events, first.event] };
    expect(runCommand(linked, { kind: "item_link", to: "PAY-413", linkKind: "blocks" }, PM, "PM").ok).toBe(false);
    // same target, different kind is fine
    expect(runCommand(linked, { kind: "item_link", to: "PAY-413", linkKind: "relates" }, PM, "PM").ok).toBe(true);
  });

  it("item_unlink removes the link (round-trips through the fold)", () => {
    const item = makeItem();
    const link = runCommand(item, { kind: "item_link", to: "PAY-413", linkKind: "blocks" }, DEV, "Dev");
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const linked = { ...item, events: [...item.events, link.event] };
    const unlink = runCommand(linked, { kind: "item_unlink", to: "PAY-413", linkKind: "blocks" }, DEV, "Dev");
    expect(unlink.ok).toBe(true);
    if (!unlink.ok) return;
    expect(unlink.event.type).toBe("ITEM_UNLINK");
    const after = deriveItem({ ...linked, events: [...linked.events, unlink.event] });
    expect(after.links).toEqual([]);
  });

  it("item_unlink of a non-existent link is rejected", () => {
    const r = runCommand(makeItem(), { kind: "item_unlink", to: "PAY-413", linkKind: "blocks" }, PM, "PM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no .*link/i);
  });

  it("both roles may link and unlink", () => {
    const item = makeItem();
    expect(runCommand(item, { kind: "item_link", to: "PAY-413", linkKind: "relates" }, PM, "PM").ok).toBe(true);
    expect(runCommand(item, { kind: "item_link", to: "PAY-413", linkKind: "relates" }, DEV, "Dev").ok).toBe(true);
  });
});

/* ---------------- phase 8: subtasks + time tracking through the wire ---------------- */
describe("phase 8 commands", () => {
  it("wiCreate carries parentWiId", () => {
    const item = makeItem([WI]);
    const r = runCommand(item,
      { kind: "wiCreate", draft: { type: "task", title: "Sub", assignee: "", parentWiId: "PAY-418" } } as Command,
      PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.wi?.parentWiId).toBe("PAY-418");
  });

  it("wiUpdate accepts estimates and clears them via null", () => {
    const wi: WorkItem = { ...WI, originalEstimate: 8 };
    const item = makeItem([wi]);
    const r = runCommand(item,
      { kind: "wiUpdate", wiId: "PAY-418", patch: { originalEstimate: null, remainingEstimate: 4 } } as Command,
      PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.wi?.originalEstimate).toBe(null);
    expect(r.event.wi?.remainingEstimate).toBe(4);
  });

  it("wiWorklog logs hours with an optional note", () => {
    const item = makeItem([WI]);
    const r = runCommand(item,
      { kind: "wiWorklog", wiId: "PAY-418", hours: 2.5, note: "pairing" } as Command,
      DEV, "Dev");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.type).toBe("WI_WORKLOG");
    expect(r.event.hours).toBe(2.5);
    expect(r.event.text).toBe("pairing");
  });

  it("wiWorklog schema rejects non-positive hours", () => {
    const parsed = CommandSchema.safeParse({ kind: "wiWorklog", wiId: "PAY-418", hours: 0, note: "" });
    expect(parsed.success).toBe(false);
  });
});

describe("custom fields over the wire", () => {
  it("wiUpdate accepts a customFields delta with per-key nulls", () => {
    const wi: WorkItem = { ...WI, customFields: { a: "1" } };
    const item = makeItem([wi]);
    const r = runCommand(item,
      { kind: "wiUpdate", wiId: "PAY-418", patch: { customFields: { a: null, b: "2" } } } as Command,
      PM, "PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.wi?.customFields).toEqual({ a: null, b: "2" });
  });

  it("schema rejects oversized custom-field payloads", () => {
    const big = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["k" + i, "v"]));
    const parsed = CommandSchema.safeParse({ kind: "wiUpdate", wiId: "PAY-418", patch: { customFields: big } });
    expect(parsed.success).toBe(false);
  });
});

describe("custom fields schema acceptance", () => {
  it("schema accepts a valid customFields delta", () => {
    const parsed = CommandSchema.safeParse({
      kind: "wiUpdate", wiId: "PAY-418",
      patch: { customFields: { team_area: "checkout", build: 42, gone: null } },
    });
    expect(parsed.success).toBe(true);
  });
});
