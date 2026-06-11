/* Zod shape tests for the bulk-command request (POST /api/items/bulk).
   The per-op `command` MUST be the same CommandSchema the single-command
   route uses — these tests prove the reuse (bad commands are rejected). */
import { describe, expect, it } from "vitest";
import { BulkRequestSchema } from "./commands";
import { PERMISSIONS } from "./permissions";

const flagCmd = { kind: "flag", flag: "blocked", value: true, reason: null };
const op = (itemId = "PAY-412", expectedVersion = 3, command: unknown = flagCmd) =>
  ({ itemId, expectedVersion, command });

describe("BulkRequestSchema", () => {
  it("accepts 1 op and exactly 50 ops", () => {
    expect(BulkRequestSchema.safeParse({ ops: [op()] }).success).toBe(true);
    expect(BulkRequestSchema.safeParse({ ops: Array.from({ length: 50 }, () => op()) }).success).toBe(true);
  });

  it("rejects 0 ops and 51 ops (1..50 bound)", () => {
    expect(BulkRequestSchema.safeParse({ ops: [] }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({ ops: Array.from({ length: 51 }, () => op()) }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({}).success).toBe(false); // ops required
  });

  it("reuses the single-route CommandSchema for each op's command", () => {
    // a real command kind passes…
    expect(BulkRequestSchema.safeParse({
      ops: [op("PAY-412", 0, { kind: "wiUpdate", wiId: "PAY-418", patch: { sprint: "Sprint 25" } })],
    }).success).toBe(true);
    // …unknown kinds, bad enums and extra keys are rejected exactly like the single route
    expect(BulkRequestSchema.safeParse({ ops: [op("PAY-412", 0, { kind: "dropTables" })] }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({ ops: [op("PAY-412", 0, { kind: "transition", to: "nope", reason: null })] }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({ ops: [op("PAY-412", 0, { ...flagCmd, extra: 1 })] }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({ ops: [op("PAY-412", 0, { kind: "wiUpdate", wiId: "X", patch: { id: "evil" } })] }).success).toBe(false);
    // one bad command anywhere in the batch fails the whole parse
    expect(BulkRequestSchema.safeParse({ ops: [op(), op("PAY-412", 1, { kind: "nope" })] }).success).toBe(false);
  });

  it("validates the op envelope: itemId, integer expectedVersion ≥ 0, no extras", () => {
    expect(BulkRequestSchema.safeParse({ ops: [{ expectedVersion: 0, command: flagCmd }] }).success).toBe(false);    // missing itemId
    expect(BulkRequestSchema.safeParse({ ops: [{ itemId: "PAY-412", command: flagCmd }] }).success).toBe(false);     // missing version
    expect(BulkRequestSchema.safeParse({ ops: [op("PAY-412", -1)] }).success).toBe(false);                            // negative
    expect(BulkRequestSchema.safeParse({ ops: [op("PAY-412", 1.5)] }).success).toBe(false);                           // non-integer
    expect(BulkRequestSchema.safeParse({ ops: [{ ...op(), extra: 1 }] }).success).toBe(false);                        // extra key on op
    expect(BulkRequestSchema.safeParse({ ops: [op()], extra: 1 }).success).toBe(false);                               // extra key on body
  });
});

describe("bulk_commands permission", () => {
  it("both PM and Dev may issue bulk commands (per-command guards still apply)", () => {
    expect(PERMISSIONS.bulk_commands).toEqual(["PM", "Dev"]);
  });
});
