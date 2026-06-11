import { describe, it, expect } from "vitest";
import { parseCql, runCql, type CqlRow } from "./cql";

/* CQL — Cadence Query Language, a JQL subset over flat work-item rows.
   parseCql never throws: { ok, query } | { ok: false, error }. */

function row(over: Partial<CqlRow> = {}): CqlRow {
  return {
    id: "PAY-418", title: "Render Apple Pay button", item: "PAY-412",
    type: "story", state: "todo", assignee: "Sam Okafor",
    sprint: "S1", points: 3, priority: 2, severity: undefined,
    phase: "build", tags: ["payments", "ui"], parent: undefined,
    cf: { build: 42 },
    ...over,
  };
}

function matches(cql: string, r: CqlRow): boolean {
  const p = parseCql(cql);
  if (!p.ok) throw new Error("parse failed: " + p.error);
  return runCql(p.query, [r]).length === 1;
}

describe("parseCql", () => {
  it("rejects empty input and unknown fields with a friendly error", () => {
    expect(parseCql("").ok).toBe(false);
    const bad = parseCql("flavor = vanilla");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/flavor/);
  });

  it("rejects dangling operators and unterminated strings", () => {
    expect(parseCql("state =").ok).toBe(false);
    expect(parseCql('title ~ "unterminated').ok).toBe(false);
    expect(parseCql("state = todo AND").ok).toBe(false);
  });
});

describe("matching", () => {
  it("equality is case-insensitive for strings", () => {
    expect(matches("state = TODO", row())).toBe(true);
    expect(matches('assignee = "sam okafor"', row())).toBe(true);
    expect(matches("state = done", row())).toBe(false);
  });

  it("!= and numeric comparisons", () => {
    expect(matches("state != done", row())).toBe(true);
    expect(matches("points > 2", row())).toBe(true);
    expect(matches("points >= 3", row())).toBe(true);
    expect(matches("points < 3", row())).toBe(false);
    expect(matches("priority <= 2", row())).toBe(true);
  });

  it("~ is case-insensitive substring; !~ negates", () => {
    expect(matches('title ~ "apple pay"', row())).toBe(true);
    expect(matches('title !~ refund', row())).toBe(true);
    expect(matches("title ~ refund", row())).toBe(false);
  });

  it("tag equality means contains", () => {
    expect(matches("tag = payments", row())).toBe(true);
    expect(matches("tag = backend", row())).toBe(false);
  });

  it("IN and NOT IN lists", () => {
    expect(matches("state in (todo, in_progress)", row())).toBe(true);
    expect(matches("state not in (done, blocked)", row())).toBe(true);
    expect(matches("type in (bug)", row())).toBe(false);
  });

  it("EMPTY matches unset fields", () => {
    expect(matches("severity = EMPTY", row())).toBe(true);
    expect(matches("sprint = EMPTY", row())).toBe(false);
    expect(matches("sprint != EMPTY", row())).toBe(true);
  });

  it("AND binds tighter than OR", () => {
    // (state = done AND points > 1) OR type = story → true via the OR arm
    expect(matches("state = done AND points > 1 OR type = story", row())).toBe(true);
    // state = done AND (points > 1 OR type = story) would be false — proves precedence
    expect(matches("type = story AND state = done OR points = 3", row())).toBe(true);
    expect(matches("type = bug AND state = todo OR points = 99", row())).toBe(false);
  });

  it("custom fields via cf.<key>", () => {
    expect(matches("cf.build = 42", row())).toBe(true);
    expect(matches("cf.build > 40", row())).toBe(true);
    expect(matches("cf.missing = EMPTY", row())).toBe(true);
  });
});

describe("runCql — filtering and ORDER BY", () => {
  const rows: CqlRow[] = [
    row({ id: "A-1", points: 5, state: "todo" }),
    row({ id: "A-2", points: 1, state: "done" }),
    row({ id: "A-3", points: 3, state: "todo" }),
  ];

  it("filters and preserves input order without ORDER BY", () => {
    const p = parseCql("state = todo");
    if (!p.ok) throw new Error(p.error);
    expect(runCql(p.query, rows).map((r) => r.id)).toEqual(["A-1", "A-3"]);
  });

  it("ORDER BY field ASC/DESC; unset values sort last", () => {
    const p = parseCql("points > 0 order by points desc");
    if (!p.ok) throw new Error(p.error);
    expect(runCql(p.query, rows).map((r) => r.id)).toEqual(["A-1", "A-3", "A-2"]);

    const p2 = parseCql("state != EMPTY order by points");
    if (!p2.ok) throw new Error(p2.error);
    expect(runCql(p2.query, rows).map((r) => r.id)).toEqual(["A-2", "A-3", "A-1"]);
  });
});
