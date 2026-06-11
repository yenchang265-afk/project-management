import { describe, it, expect } from "vitest";
import {
  STATES,
  REJECT_REASONS,
  deriveItem,
  gateStatus,
  legalTransitions,
  applyTransition,
  itemBlockedBy,
  timeInState,
  reworkRate,
  leadTime,
  planVsActual,
  spineOrder,
  type Item,
  type PdlcEvent,
  type StateKey,
} from "./engine";

const DAY = 24 * 3600e3;

function makeItem(events: PdlcEvent[]): Item {
  return {
    id: "TEST-1",
    title: "Test item",
    area: "Payments",
    priority: "High",
    parent: null,
    type: "feature",
    stakeholders: [],
    workItems: [],
    events,
  };
}

function E(ageDays: number, type: PdlcEvent["type"], payload?: Partial<PdlcEvent>): PdlcEvent {
  return {
    id: "t" + Math.random().toString(36).slice(2),
    item: "TEST-1",
    type,
    actor: "Maya Chen",
    role: "PM",
    ts: Date.now() - ageDays * DAY,
    ...payload,
  };
}

describe("STATES / spine", () => {
  it("has 12 spine states in order", () => {
    expect(spineOrder.map((s) => s.key)).toEqual([
      "backlog", "in_discovery", "defined", "technical_design",
      "in_development", "in_code_review", "in_qa", "staging_uat",
      "deploying", "released", "monitoring", "done",
    ]);
  });
  it("has 3 off-spine states", () => {
    expect(STATES.rejected.lane).toBe("off");
    expect(STATES.deferred.terminal).toBe(true);
    expect(STATES.rolled_back.recovery).toBe(true);
  });
});

describe("deriveItem", () => {
  it("derives backlog from CREATE", () => {
    const snap = deriveItem(makeItem([E(1, "CREATE", { to: "backlog" })]));
    expect(snap.state).toBe("backlog");
  });

  it("folds transitions to latest state", () => {
    const snap = deriveItem(makeItem([
      E(3, "CREATE", { to: "backlog" }),
      E(2, "TRANSITION", { from: "backlog", to: "in_discovery", kind: "forward" }),
      E(1, "TRANSITION", { from: "in_discovery", to: "defined", kind: "forward" }),
    ]));
    expect(snap.state).toBe("defined");
  });

  it("seeds condition defaults from both gates", () => {
    const snap = deriveItem(makeItem([E(1, "CREATE", { to: "backlog" })]));
    expect(snap.conditions.spec_approved).toBe("required");
    expect(snap.conditions.threat_model).toBe("not_applicable");
    expect(snap.conditions.security_review_approved).toBe("not_applicable");
  });

  it("shift-left risk flips conditional conditions to required", () => {
    const snap = deriveItem(makeItem([
      E(2, "CREATE", { to: "backlog" }),
      E(1, "SHIFT_LEFT_SET", { risk: "touches_auth", value: true }),
    ]));
    expect(snap.conditions.threat_model).toBe("required");
    expect(snap.conditions.security_review_approved).toBe("required");
    expect(snap.conditions.compliance_signoff).toBe("not_applicable");
  });

  it("clearing a risk reverts unsatisfied conditional conditions", () => {
    const snap = deriveItem(makeItem([
      E(3, "CREATE", { to: "backlog" }),
      E(2, "SHIFT_LEFT_SET", { risk: "touches_auth", value: true }),
      E(1, "SHIFT_LEFT_SET", { risk: "touches_auth", value: false }),
    ]));
    expect(snap.conditions.threat_model).toBe("not_applicable");
  });

  it("approved sub-track auto-satisfies its linked release condition", () => {
    const snap = deriveItem(makeItem([
      E(3, "CREATE", { to: "backlog" }),
      E(2, "SHIFT_LEFT_SET", { risk: "touches_auth", value: true }),
      E(1, "SUBTRACK", { track: "security", to: "approved" }),
    ]));
    expect(snap.conditions.security_review_approved).toBe("satisfied");
  });

  it("tracks flags, signoffs and children", () => {
    const snap = deriveItem(makeItem([
      E(3, "CREATE", { to: "backlog" }),
      E(2, "FLAG_SET", { flag: "blocked", value: true, reason: "waiting" }),
      E(1, "GATE_SIGNOFF", { gate: "ready_for_dev" }),
      E(0.5, "SPAWN_CHILD", { child: "TEST-2" }),
    ]));
    expect(snap.flags.blocked).toEqual({ reason: "waiting" });
    expect(snap.signoffs.ready_for_dev.PM).toBe("Maya Chen");
    expect(snap.children).toEqual(["TEST-2"]);
  });
});

describe("deriveItem — item comments (ITEM_COMMENT)", () => {
  it("exposes an empty comments list when there are no ITEM_COMMENT events", () => {
    const snap = deriveItem(makeItem([E(1, "CREATE", { to: "backlog" })]));
    expect(snap.comments).toEqual([]);
  });

  it("appending ITEM_COMMENT surfaces {id, author, role, ts, text} on the snapshot", () => {
    const ts = Date.now() - DAY;
    const snap = deriveItem(makeItem([
      E(2, "CREATE", { to: "backlog" }),
      E(1, "ITEM_COMMENT", { id: "ic1", actor: "Sam Okafor", role: "Dev", ts, text: "Looks good to me" }),
    ]));
    expect(snap.comments).toEqual([
      { id: "ic1", author: "Sam Okafor", role: "Dev", ts, text: "Looks good to me" },
    ]);
  });

  it("multiple comments come back in chronological order even when events arrive out of order", () => {
    const snap = deriveItem(makeItem([
      E(4, "CREATE", { to: "backlog" }),
      E(1, "ITEM_COMMENT", { id: "ic3", text: "third" }),
      E(3, "ITEM_COMMENT", { id: "ic1", text: "first" }),
      E(2, "ITEM_COMMENT", { id: "ic2", text: "second" }),
    ]));
    expect(snap.comments.map((c) => c.id)).toEqual(["ic1", "ic2", "ic3"]);
    expect(snap.comments.map((c) => c.text)).toEqual(["first", "second", "third"]);
  });

  it("ignores ITEM_COMMENT events without text and leaves work-item threads untouched", () => {
    const snap = deriveItem(makeItem([
      E(3, "CREATE", { to: "backlog" }),
      E(2, "ITEM_COMMENT", { id: "ic0" }),                       // malformed: no text
      E(1, "WI_COMMENT", { id: "wc1", wiId: "WI-1", text: "wi thread" }),
    ]));
    expect(snap.comments).toEqual([]);
  });
});

describe("gateStatus", () => {
  it("blocked while required conditions remain", () => {
    const snap = deriveItem(makeItem([E(1, "CREATE", { to: "backlog" })]));
    const gs = gateStatus("ready_for_dev", snap);
    expect(gs.open).toBe(false);
    expect(gs.blocking.map((c) => c.key).sort()).toEqual(["design_reviewed", "estimated", "spec_approved"]);
  });

  it("open requires all conditions done AND dual sign-off", () => {
    const base = [
      E(5, "CREATE", { to: "backlog" }),
      E(4, "CONDITION_SATISFY", { condition: "spec_approved" }),
      E(4, "CONDITION_SATISFY", { condition: "design_reviewed" }),
      E(4, "CONDITION_WAIVE", { condition: "estimated" }),
      E(3, "GATE_SIGNOFF", { gate: "ready_for_dev", role: "PM" }),
    ];
    let gs = gateStatus("ready_for_dev", deriveItem(makeItem(base)));
    expect(gs.open).toBe(false); // Dev sign-off missing
    gs = gateStatus("ready_for_dev", deriveItem(makeItem([
      ...base,
      E(2, "GATE_SIGNOFF", { gate: "ready_for_dev", role: "Dev", actor: "Sam Okafor" }),
    ])));
    expect(gs.open).toBe(true);
  });
});

describe("applyTransition", () => {
  const atState = (state: StateKey) => {
    // walk the happy path up to `state` with everything satisfied/signed
    const evs: PdlcEvent[] = [E(20, "CREATE", { to: "backlog" })];
    const path = spineOrder.map((s) => s.key);
    const conds = ["spec_approved", "design_reviewed", "estimated", "qa_passed", "pm_acceptance", "docs_runbook_ready"];
    conds.forEach((c) => evs.push(E(19, "CONDITION_SATISFY", { condition: c })));
    (["ready_for_dev", "release"] as const).forEach((g) => {
      evs.push(E(18, "GATE_SIGNOFF", { gate: g, role: "PM" }));
      evs.push(E(18, "GATE_SIGNOFF", { gate: g, role: "Dev", actor: "Sam Okafor" }));
    });
    for (let i = 1; i <= path.indexOf(state); i++)
      evs.push(E(15 - i, "TRANSITION", { from: path[i - 1], to: path[i], kind: "forward" }));
    return makeItem(evs);
  };

  it("rejects illegal transition", () => {
    const res = applyTransition(makeItem([E(1, "CREATE", { to: "backlog" })]), "done", "Maya Chen", "PM", null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.type).toBe("ILLEGAL_TRANSITION");
  });

  it("enforces role guard", () => {
    const res = applyTransition(makeItem([E(1, "CREATE", { to: "backlog" })]), "in_discovery", "Sam Okafor", "Dev", null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection.type).toBe("ROLE_GUARD");
  });

  it("blocks gated transition on unsatisfied conditions", () => {
    const res = applyTransition(atState("technical_design"), "in_development", "Maya Chen", "PM", null);
    // conditions satisfied + signoffs in atState fixture, so this passes; build a bare one:
    expect(res.ok).toBe(true);
    const bare = makeItem([
      E(5, "CREATE", { to: "backlog" }),
      E(4, "TRANSITION", { from: "backlog", to: "in_discovery", kind: "forward" }),
      E(3, "TRANSITION", { from: "in_discovery", to: "defined", kind: "forward" }),
      E(2, "TRANSITION", { from: "defined", to: "technical_design", kind: "forward" }),
    ]);
    const res2 = applyTransition(bare, "in_development", "Maya Chen", "PM", null);
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.rejection.type).toBe("GATE_CONDITIONS_UNSATISFIED");
  });

  it("blocks gated transition on missing sign-off", () => {
    const evs = [
      E(5, "CREATE", { to: "backlog" }),
      E(4.5, "CONDITION_SATISFY", { condition: "spec_approved" }),
      E(4.5, "CONDITION_SATISFY", { condition: "design_reviewed" }),
      E(4.5, "CONDITION_SATISFY", { condition: "estimated" }),
      E(4, "TRANSITION", { from: "backlog", to: "in_discovery", kind: "forward" }),
      E(3, "TRANSITION", { from: "in_discovery", to: "defined", kind: "forward" }),
      E(2, "TRANSITION", { from: "defined", to: "technical_design", kind: "forward" }),
      E(1, "GATE_SIGNOFF", { gate: "ready_for_dev", role: "PM" }),
    ];
    const res = applyTransition(makeItem(evs), "in_development", "Maya Chen", "PM", null);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.rejection.type).toBe("GATE_SIGNOFF_MISSING");
      expect(res.rejection.detail.missing).toEqual(["Dev"]);
    }
  });

  it("requires a valid rejection reason", () => {
    const item = makeItem([E(1, "CREATE", { to: "backlog" })]);
    const bad = applyTransition(item, "rejected", "Maya Chen", "PM", null);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.rejection.type).toBe("REASON_REQUIRED");
    const good = applyTransition(item, "rejected", "Maya Chen", "PM", "out_of_scope");
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.event.kind).toBe("terminal");
  });

  it("legalTransitions lists rework loops from in_code_review", () => {
    const tos = legalTransitions("in_code_review").map((t) => t.to);
    expect(tos).toContain("in_qa");
    expect(tos).toContain("in_development");
  });

  it("REJECT_REASONS fixed list", () => {
    expect(REJECT_REASONS).toEqual(["duplicate", "out_of_scope", "wont_fix"]);
  });
});

describe("analytics", () => {
  const item = makeItem([
    E(10, "CREATE", { to: "backlog" }),
    E(8, "TRANSITION", { from: "backlog", to: "in_discovery", kind: "forward" }),
    E(6, "TRANSITION", { from: "in_discovery", to: "defined", kind: "forward" }),
    E(5, "TRANSITION", { from: "defined", to: "in_discovery", kind: "rework" }),
  ]);

  it("timeInState accumulates per state", () => {
    const tis = timeInState(item);
    expect(tis.backlog).toBeGreaterThan(1.9 * DAY);
    expect(tis.backlog).toBeLessThan(2.1 * DAY);
    // in_discovery: 8d->6d plus 5d->now = ~7d total
    expect(tis.in_discovery).toBeGreaterThan(6.9 * DAY);
  });

  it("reworkRate counts backward moves", () => {
    expect(reworkRate(item)).toBe(1);
  });

  it("leadTime spans from first event", () => {
    expect(leadTime(item)).toBeGreaterThan(9.9 * DAY);
  });

  it("planVsActual derives status + phases", () => {
    const pa = planVsActual(item);
    expect(pa.phases.length).toBe(12);
    expect(["behind", "ahead", "on_track"]).toContain(pa.status);
    expect(pa.phases[0].done).toBe(true); // backlog is behind current spine
    expect(pa.phases.find((p) => p.key === "in_discovery")?.current).toBe(true);
  });
});

/* ---------------- item-level links (ITEM_LINK / ITEM_UNLINK) ----------------
   Informational v1 — links never gate transitions; the inverse direction is
   computed by callers via itemBlockedBy (mirror of wiBlockedBy). */
describe("item links — fold", () => {
  it("snapshot starts with no links", () => {
    const snap = deriveItem(makeItem([E(1, "CREATE", { to: "backlog" })]));
    expect(snap.links).toEqual([]);
  });

  it("ITEM_LINK folds into snap.links", () => {
    const snap = deriveItem(makeItem([
      E(2, "CREATE", { to: "backlog" }),
      E(1, "ITEM_LINK", { to: "TEST-2", linkKind: "blocks" }),
    ]));
    expect(snap.links).toEqual([{ to: "TEST-2", linkKind: "blocks" }]);
  });

  it("duplicate ITEM_LINK events de-dupe to one link", () => {
    const snap = deriveItem(makeItem([
      E(3, "CREATE", { to: "backlog" }),
      E(2, "ITEM_LINK", { to: "TEST-2", linkKind: "relates" }),
      E(1, "ITEM_LINK", { to: "TEST-2", linkKind: "relates" }),
    ]));
    expect(snap.links).toEqual([{ to: "TEST-2", linkKind: "relates" }]);
  });

  it("multiple kinds to the same target (and same kind to other targets) coexist", () => {
    const snap = deriveItem(makeItem([
      E(4, "CREATE", { to: "backlog" }),
      E(3, "ITEM_LINK", { to: "TEST-2", linkKind: "blocks" }),
      E(2, "ITEM_LINK", { to: "TEST-2", linkKind: "relates" }),
      E(1, "ITEM_LINK", { to: "TEST-3", linkKind: "blocks" }),
    ]));
    expect(snap.links).toEqual([
      { to: "TEST-2", linkKind: "blocks" },
      { to: "TEST-2", linkKind: "relates" },
      { to: "TEST-3", linkKind: "blocks" },
    ]);
  });

  it("ITEM_UNLINK removes only the matching {to, linkKind} pair", () => {
    const snap = deriveItem(makeItem([
      E(5, "CREATE", { to: "backlog" }),
      E(4, "ITEM_LINK", { to: "TEST-2", linkKind: "blocks" }),
      E(3, "ITEM_LINK", { to: "TEST-2", linkKind: "relates" }),
      E(2, "ITEM_LINK", { to: "TEST-3", linkKind: "blocks" }),
      E(1, "ITEM_UNLINK", { to: "TEST-2", linkKind: "blocks" }),
    ]));
    expect(snap.links).toEqual([
      { to: "TEST-2", linkKind: "relates" },
      { to: "TEST-3", linkKind: "blocks" },
    ]);
  });

  it("a link can be re-added after an unlink", () => {
    const snap = deriveItem(makeItem([
      E(4, "CREATE", { to: "backlog" }),
      E(3, "ITEM_LINK", { to: "TEST-2", linkKind: "blocks" }),
      E(2, "ITEM_UNLINK", { to: "TEST-2", linkKind: "blocks" }),
      E(1, "ITEM_LINK", { to: "TEST-2", linkKind: "blocks" }),
    ]));
    expect(snap.links).toEqual([{ to: "TEST-2", linkKind: "blocks" }]);
  });

  it("links are informational — they do not gate transitions", () => {
    // TEST-1 carries an outgoing blocks link; applyTransition is single-item
    // and ignores links entirely, so the spine still moves.
    const item = makeItem([
      E(2, "CREATE", { to: "backlog" }),
      E(1, "ITEM_LINK", { to: "TEST-2", linkKind: "blocks" }),
    ]);
    const r = applyTransition(item, "in_discovery", "Maya Chen", "PM", null);
    expect(r.ok).toBe(true);
  });
});

describe("itemBlockedBy", () => {
  function namedItem(id: string, events: PdlcEvent[]): Item {
    return { ...makeItem(events.map((e) => ({ ...e, item: id }))), id };
  }

  it("returns ids of open items with a blocks link pointing at the item", () => {
    const a = namedItem("TEST-A", [E(2, "CREATE", { to: "backlog" })]);
    const b = namedItem("TEST-B", [
      E(3, "CREATE", { to: "backlog" }),
      E(2, "TRANSITION", { from: "backlog", to: "in_discovery", kind: "forward" }),
      E(1, "ITEM_LINK", { to: "TEST-A", linkKind: "blocks" }),
    ]);
    expect(itemBlockedBy(a, [a, b])).toEqual(["TEST-B"]);
    expect(itemBlockedBy(b, [a, b])).toEqual([]); // direction matters
  });

  it("a done (closed-lane) blocker no longer blocks", () => {
    const a = namedItem("TEST-A", [E(3, "CREATE", { to: "backlog" })]);
    const b = namedItem("TEST-B", [
      E(3, "CREATE", { to: "backlog" }),
      E(2, "ITEM_LINK", { to: "TEST-A", linkKind: "blocks" }),
      E(1, "TRANSITION", { from: "monitoring", to: "done", kind: "forward" }),
    ]);
    expect(itemBlockedBy(a, [a, b])).toEqual([]);
  });

  it("non-blocks links and links to other items don't count", () => {
    const a = namedItem("TEST-A", [E(2, "CREATE", { to: "backlog" })]);
    const b = namedItem("TEST-B", [
      E(3, "CREATE", { to: "backlog" }),
      E(2, "ITEM_LINK", { to: "TEST-A", linkKind: "relates" }),
      E(1, "ITEM_LINK", { to: "TEST-C", linkKind: "blocks" }),
    ]);
    expect(itemBlockedBy(a, [a, b])).toEqual([]);
  });

  it("an unlinked blocker stops blocking", () => {
    const a = namedItem("TEST-A", [E(3, "CREATE", { to: "backlog" })]);
    const b = namedItem("TEST-B", [
      E(3, "CREATE", { to: "backlog" }),
      E(2, "ITEM_LINK", { to: "TEST-A", linkKind: "blocks" }),
      E(1, "ITEM_UNLINK", { to: "TEST-A", linkKind: "blocks" }),
    ]);
    expect(itemBlockedBy(a, [a, b])).toEqual([]);
  });
});
