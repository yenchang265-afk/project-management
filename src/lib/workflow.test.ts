/* Workflow-scheme validation tests (G-13). A scheme is a TransitionDef[] that
   replaces the engine's built-in TRANSITIONS for one project. validateWorkflow
   enforces the engine invariants an editor must not let a user break:
   valid state/role/gate references, gates only on forward transitions, no
   duplicate edges, and full spine reachability from backlog. The shipped
   default (TRANSITIONS) must always validate. */
import { describe, expect, it } from "vitest";
import { applyTransition, ev, legalTransitions, TRANSITIONS, type Item, type StateKey, type TransitionDef } from "./engine";
import { validateWorkflow } from "./workflow";

const ok = (r: ReturnType<typeof validateWorkflow>) => r.ok;
const errs = (r: ReturnType<typeof validateWorkflow>) => (r.ok ? [] : r.errors);

describe("validateWorkflow", () => {
  it("accepts the shipped default transition table", () => {
    const r = validateWorkflow(TRANSITIONS);
    expect(ok(r)).toBe(true);
  });

  it("rejects an empty scheme (spine unreachable)", () => {
    const r = validateWorkflow([]);
    expect(ok(r)).toBe(false);
    expect(errs(r).join(" ")).toMatch(/reach|spine/i);
  });

  it("rejects an unknown from/to state", () => {
    const bad: TransitionDef[] = [
      ...TRANSITIONS,
      { from: "backlog", to: "nowhere" as never, roles: ["PM"], kind: "forward", label: "x" },
    ];
    const r = validateWorkflow(bad);
    expect(ok(r)).toBe(false);
    expect(errs(r).join(" ")).toMatch(/nowhere/);
  });

  it("rejects an empty or invalid role list", () => {
    const bad: TransitionDef[] = [
      ...TRANSITIONS,
      { from: "backlog", to: "deferred", roles: [], kind: "terminal", label: "x" },
    ];
    expect(ok(validateWorkflow(bad))).toBe(false);
  });

  it("rejects a gate on a non-forward transition", () => {
    const bad: TransitionDef[] = [
      ...TRANSITIONS,
      { from: "in_code_review", to: "in_development", roles: ["Dev"], kind: "rework", gate: "release", label: "x" },
    ];
    const r = validateWorkflow(bad);
    expect(ok(r)).toBe(false);
    expect(errs(r).join(" ")).toMatch(/gate/i);
  });

  it("rejects an unknown gate key", () => {
    const bad: TransitionDef[] = [
      ...TRANSITIONS,
      { from: "defined", to: "technical_design", roles: ["Dev"], kind: "forward", gate: "ghost" as never, label: "x" },
    ];
    expect(ok(validateWorkflow(bad))).toBe(false);
  });

  it("rejects duplicate (from,to) edges", () => {
    const bad: TransitionDef[] = [
      ...TRANSITIONS,
      { from: "backlog", to: "in_discovery", roles: ["PM"], kind: "forward", label: "dupe" },
    ];
    const r = validateWorkflow(bad);
    expect(ok(r)).toBe(false);
    expect(errs(r).join(" ")).toMatch(/duplicate/i);
  });

  it("rejects a scheme that cannot reach a mid-spine state", () => {
    // drop the edge into in_qa → spine states 6..11 become unreachable
    const bad = TRANSITIONS.filter((t) => !(t.from === "in_code_review" && t.to === "in_qa"));
    const r = validateWorkflow(bad);
    expect(ok(r)).toBe(false);
    expect(errs(r).join(" ")).toMatch(/reach|in_qa|spine/i);
  });
});

const itemAt = (state: StateKey): Item => ({
  id: "WF-1", title: "t", area: "A", priority: "High", parent: null, type: "feature",
  stakeholders: [], workItems: [],
  events: [ev("WF-1", "CREATE", "sys", "PM", { to: state })],
});

describe("custom transitions threading", () => {
  it("legalTransitions defaults to the built-in table", () => {
    expect(legalTransitions("backlog")).toEqual(TRANSITIONS.filter((t) => t.from === "backlog"));
  });

  it("legalTransitions honours a custom table", () => {
    const custom: TransitionDef[] = [
      { from: "backlog", to: "done", roles: ["PM"], kind: "forward", label: "Skip to done" },
    ];
    const legal = legalTransitions("backlog", custom);
    expect(legal).toEqual(custom);
  });

  it("applyTransition with a custom table allows a move the default rejects", () => {
    const custom: TransitionDef[] = [
      { from: "backlog", to: "in_qa", roles: ["PM"], kind: "forward", label: "Fast-track to QA" },
    ];
    const def = applyTransition(itemAt("backlog"), "in_qa", "Maya", "PM", null);
    expect(def.ok).toBe(false); // default has no backlog→in_qa edge
    const custEvt = applyTransition(itemAt("backlog"), "in_qa", "Maya", "PM", null, custom);
    expect(custEvt.ok).toBe(true);
  });

  it("applyTransition with a custom table enforces that table's role guard", () => {
    const custom: TransitionDef[] = [
      { from: "backlog", to: "in_discovery", roles: ["Dev"], kind: "forward", label: "Start (Dev only)" },
    ];
    const r = applyTransition(itemAt("backlog"), "in_discovery", "Maya", "PM", null, custom);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.type).toBe("ROLE_GUARD");
  });
});
