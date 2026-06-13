/* WIP-limit helpers (Jira board WIP limits). Pure: a per-column limit warns
   when a column is at or over capacity. A limit of 0 / undefined means "no
   limit". The board uses wipLevel for per-column styling and overLimitColumns
   to flag the whole board. */
import { describe, expect, it } from "vitest";
import { overLimitColumns, wipLevel } from "./wip";

describe("wipLevel", () => {
  it("returns ok when there is no limit", () => {
    expect(wipLevel(99, undefined)).toBe("ok");
    expect(wipLevel(99, 0)).toBe("ok");
    expect(wipLevel(99, -3)).toBe("ok");
  });
  it("returns ok below the limit, at on the limit, over above it", () => {
    expect(wipLevel(2, 3)).toBe("ok");
    expect(wipLevel(3, 3)).toBe("at");
    expect(wipLevel(4, 3)).toBe("over");
  });
  it("treats an empty column as ok", () => {
    expect(wipLevel(0, 3)).toBe("ok");
  });
});

describe("overLimitColumns", () => {
  it("lists only columns past their limit", () => {
    const counts = { todo: 5, in_progress: 3, done: 100 };
    const limits = { todo: 3, in_progress: 3, done: 0 };
    expect(overLimitColumns(counts, limits).sort()).toEqual(["todo"]);
  });
  it("ignores columns with no configured limit and missing counts", () => {
    expect(overLimitColumns({}, { in_progress: 2 })).toEqual([]);
    expect(overLimitColumns({ in_progress: 9 }, {})).toEqual([]);
  });
});
