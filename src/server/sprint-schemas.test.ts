/* Zod request schemas for the sprint routes (shared module so they are unit-testable
   without importing route files, which pull in next/headers). */
import { describe, expect, it } from "vitest";
import { CreateSprintSchema, PatchSprintSchema } from "./sprint-schemas";

describe("CreateSprintSchema", () => {
  it("accepts a name with optional ISO dates", () => {
    expect(CreateSprintSchema.safeParse({ name: "Sprint 24" }).success).toBe(true);
    expect(CreateSprintSchema.safeParse({ name: "Sprint 24", start: "2026-06-01", end: "2026-06-14" }).success).toBe(true);
    expect(CreateSprintSchema.safeParse({ name: "Sprint 24", start: null, end: null }).success).toBe(true);
  });

  it("rejects bad names, bad dates, and unknown keys", () => {
    expect(CreateSprintSchema.safeParse({}).success).toBe(false);
    expect(CreateSprintSchema.safeParse({ name: "x" }).success).toBe(false);            // too short
    expect(CreateSprintSchema.safeParse({ name: "n".repeat(121) }).success).toBe(false); // > VARCHAR(120)
    expect(CreateSprintSchema.safeParse({ name: "Sprint", start: "June 1" }).success).toBe(false);
    expect(CreateSprintSchema.safeParse({ name: "Sprint", end: "2026-6-1" }).success).toBe(false);
    expect(CreateSprintSchema.safeParse({ name: "Sprint", nope: 1 }).success).toBe(false); // strict
  });
});

describe("PatchSprintSchema", () => {
  it("accepts any subset of name/start/end/state", () => {
    expect(PatchSprintSchema.safeParse({ state: "active" }).success).toBe(true);
    expect(PatchSprintSchema.safeParse({ name: "Sprint 25" }).success).toBe(true);
    expect(PatchSprintSchema.safeParse({ start: "2026-06-01", end: null }).success).toBe(true);
  });

  it("rejects an empty patch, bad state values, and unknown keys", () => {
    expect(PatchSprintSchema.safeParse({}).success).toBe(false);
    expect(PatchSprintSchema.safeParse({ state: "archived" }).success).toBe(false);
    expect(PatchSprintSchema.safeParse({ teamId: "team-x" }).success).toBe(false);
  });
});
