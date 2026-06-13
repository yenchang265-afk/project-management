/* Project-template registry tests: the default seeds nothing (today's
   behaviour, unchanged) and lookups are total — unknown ids return null so
   the create route can 422 instead of throwing. */
import { describe, expect, it } from "vitest";
import { PROJECT_TEMPLATES, templateById } from "./templates";

describe("project templates", () => {
  it("exposes a default 'cadence-pdlc' that seeds nothing", () => {
    const def = templateById("cadence-pdlc");
    expect(def).not.toBeNull();
    expect(def!.components).toEqual([]);
    expect(def!.fieldDefs).toEqual([]);
  });

  it("returns null for an unknown template id", () => {
    expect(templateById("does-not-exist")).toBeNull();
  });

  it("every template has a unique id and a non-empty name", () => {
    const ids = PROJECT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PROJECT_TEMPLATES) expect(t.name.length).toBeGreaterThan(0);
  });

  it("seeding templates carry well-formed field defs (key + name + kind)", () => {
    for (const t of PROJECT_TEMPLATES)
      for (const f of t.fieldDefs) {
        expect(f.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(f.name.length).toBeGreaterThan(0);
        expect(f.kind).toBeTruthy();
      }
  });
});
