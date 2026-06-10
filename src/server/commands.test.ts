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
