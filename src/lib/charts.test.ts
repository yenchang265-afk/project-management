import { describe, expect, it } from "vitest";
import { areaPath, linePath, niceTicks, spanTicks, stackSeries, stepPath } from "./charts";

/* Pure SVG chart-data helpers consumed by src/components/Reports.tsx.
   No DOM — every function maps data to numbers/strings. */

describe("niceTicks", () => {
  it("returns 0..niceMax with a 1/2/5 step covering max", () => {
    expect(niceTicks(10, 4)).toEqual([0, 5, 10]);
    expect(niceTicks(7, 4)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(23, 4)).toEqual([0, 10, 20, 30]);
  });
  it("handles max <= 0 with a degenerate 0..1 axis", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(-5)).toEqual([0, 1]);
  });
  it("handles fractional maxima without float dust", () => {
    expect(niceTicks(1, 4)).toEqual([0, 0.5, 1]);
    // every tick must be a clean multiple of the step
    for (const t of niceTicks(0.7, 4)) expect(String(t).length).toBeLessThan(6);
  });
  it("last tick always covers max", () => {
    for (const max of [1, 3, 9, 11, 47, 99, 101, 1234]) {
      const ticks = niceTicks(max, 4);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });
});

describe("spanTicks", () => {
  it("returns count evenly spaced values including both endpoints", () => {
    expect(spanTicks(0, 100, 5)).toEqual([0, 25, 50, 75, 100]);
    expect(spanTicks(10, 13, 4)).toEqual([10, 11, 12, 13]);
  });
  it("rounds to integers (timestamps)", () => {
    expect(spanTicks(0, 10, 4)).toEqual([0, 3, 7, 10]);
  });
  it("collapses a zero-width span to a single tick", () => {
    expect(spanTicks(42, 42, 5)).toEqual([42]);
  });
});

describe("linePath", () => {
  it("builds an SVG polyline path", () => {
    expect(linePath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 2 }])).toBe("M0,0L10,5L20,2");
  });
  it("rounds coordinates to 2 decimals", () => {
    expect(linePath([{ x: 1.23456, y: 2.005 }])).toBe("M1.23,2.01");
  });
  it("returns empty string for no points", () => {
    expect(linePath([])).toBe("");
  });
});

describe("stepPath", () => {
  it("builds a step-after path (horizontal then vertical)", () => {
    expect(stepPath([{ x: 0, y: 10 }, { x: 5, y: 4 }])).toBe("M0,10L5,10L5,4");
  });
  it("skips redundant verticals when y is unchanged", () => {
    expect(stepPath([{ x: 0, y: 10 }, { x: 5, y: 4 }, { x: 9, y: 4 }])).toBe("M0,10L5,10L5,4L9,4");
  });
  it("returns empty string for no points", () => {
    expect(stepPath([])).toBe("");
  });
});

describe("areaPath", () => {
  it("walks the upper edge forward, the lower edge backward, and closes", () => {
    expect(areaPath([{ x: 0, y: 1 }, { x: 10, y: 2 }], [{ x: 0, y: 5 }, { x: 10, y: 6 }]))
      .toBe("M0,1L10,2L10,6L0,5Z");
  });
  it("returns empty string when either edge is empty", () => {
    expect(areaPath([], [{ x: 0, y: 1 }])).toBe("");
    expect(areaPath([{ x: 0, y: 1 }], [])).toBe("");
  });
});

describe("stackSeries", () => {
  it("stacks counts bottom-up in the given key order", () => {
    const samples = [
      { ts: 100, counts: { done: 2, todo: 3 } },
      { ts: 200, counts: { done: 4, todo: 1 } },
    ];
    expect(stackSeries(samples, ["done", "todo"])).toEqual([
      { key: "done", band: [{ ts: 100, y0: 0, y1: 2 }, { ts: 200, y0: 0, y1: 4 }] },
      { key: "todo", band: [{ ts: 100, y0: 2, y1: 5 }, { ts: 200, y0: 4, y1: 5 }] },
    ]);
  });
  it("treats missing keys as zero-height bands", () => {
    const samples = [{ ts: 1, counts: { a: 2 } as Record<string, number> }];
    expect(stackSeries(samples, ["a", "b"])).toEqual([
      { key: "a", band: [{ ts: 1, y0: 0, y1: 2 }] },
      { key: "b", band: [{ ts: 1, y0: 2, y1: 2 }] },
    ]);
  });
  it("returns bands with empty point lists for no samples", () => {
    expect(stackSeries([], ["a"])).toEqual([{ key: "a", band: [] }]);
  });
});
