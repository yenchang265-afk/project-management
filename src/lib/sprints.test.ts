/* Pure sprint helpers: registry id slugging + picker merge logic (no DB, no React). */
import { describe, expect, it } from "vitest";
import { mergeSprintNames, pickDefaultSprint, sprintIdFor } from "./sprints";

describe("sprintIdFor", () => {
  it("slugs the name and suffixes the team to avoid cross-team collisions", () => {
    expect(sprintIdFor("team-checkout", "Sprint 24")).toBe("spr-sprint-24-checkout");
    expect(sprintIdFor("team-identity", "Sprint 24")).toBe("spr-sprint-24-identity");
  });

  it("strips punctuation, lowercases, and trims dashes like structure.ts slugs", () => {
    expect(sprintIdFor("team-growth", "  Q3 — Hardening!! ")).toBe("spr-q3-hardening-growth");
  });

  it("keeps a raw (non team- prefixed) team id usable as a suffix", () => {
    expect(sprintIdFor("growth-guild", "S1")).toBe("spr-s1-growth-guild");
  });

  it("caps each slugged part so the id fits VARCHAR(64)", () => {
    const id = sprintIdFor("team-" + "x".repeat(80), "n".repeat(200));
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.startsWith("spr-")).toBe(true);
  });
});

describe("mergeSprintNames (picker options)", () => {
  it("lists registry sprints first (registry order), then distinct WI strings sorted", () => {
    expect(mergeSprintNames(["Sprint 25", "Sprint 24"], ["legacy-2", "legacy-1", "legacy-2"]))
      .toEqual(["Sprint 25", "Sprint 24", "legacy-1", "legacy-2"]);
  });

  it("dedupes WI strings that already exist in the registry", () => {
    expect(mergeSprintNames(["Sprint 24"], ["Sprint 24", "Sprint 23", null, undefined, ""]))
      .toEqual(["Sprint 24", "Sprint 23"]);
  });

  it("falls back to distinct WI sprint strings when the registry is empty (current behavior)", () => {
    expect(mergeSprintNames([], ["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("returns [] with no registry and no WI sprints", () => {
    expect(mergeSprintNames([], [null, undefined])).toEqual([]);
  });
});

describe("pickDefaultSprint", () => {
  const reg = (name: string, state: "future" | "active" | "closed") => ({ name, state });

  it("prefers the active registry sprint", () => {
    expect(pickDefaultSprint([reg("Sprint 24", "closed"), reg("Sprint 25", "active")],
      ["Sprint 24", "Sprint 25", "legacy"])).toBe("Sprint 25");
  });

  it("falls back to the last merged option when nothing is active (current behavior)", () => {
    expect(pickDefaultSprint([reg("Sprint 24", "closed")], ["Sprint 24", "legacy"])).toBe("legacy");
  });

  it("ignores an active registry sprint that is not in the options", () => {
    expect(pickDefaultSprint([reg("Sprint 99", "active")], ["a", "b"])).toBe("b");
  });

  it("returns null with no options", () => {
    expect(pickDefaultSprint([], [])).toBeNull();
  });
});
