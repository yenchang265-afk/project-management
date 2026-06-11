/* =========================================================================
   CHART PRIMITIVES — pure data → SVG-path/tick helpers for the hand-rolled
   report charts (src/components/Reports.tsx). No React, no DOM, no DB.
   ========================================================================= */

export interface Pt { x: number; y: number }

const fix = (n: number) => Number(n.toFixed(10));        // kill float dust on tick math
const fmt = (n: number) => String(Math.round(n * 100) / 100); // 2-decimal SVG coords

/** Y-axis ticks: 0 .. niceMax in a "nice" step (1/2/5 × 10^k), niceMax ≥ max.
 *  `count` is a target tick count, not a guarantee. max ≤ 0 → [0, 1]. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = fix((norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const out: number[] = [];
  for (let t = 0; t < max; t = fix(t + step)) out.push(t);
  out.push(fix(out[out.length - 1] + step)); // first multiple ≥ max
  return out;
}

/** X-axis ticks: `count` evenly spaced integers from min to max inclusive
 *  (timestamps). A zero-width span collapses to a single tick. */
export function spanTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [Math.round(min)];
  return Array.from({ length: count }, (_, i) =>
    Math.round(min + ((max - min) * i) / (count - 1)));
}

/** Polyline path: M x0,y0 L x1,y1 ... — coords rounded to 2 decimals. */
export function linePath(pts: Pt[]): string {
  if (!pts.length) return "";
  return pts.map((p, i) => (i ? "L" : "M") + fmt(p.x) + "," + fmt(p.y)).join("");
}

/** Step-after path (burndown style): horizontal to the next x, then vertical
 *  to the next y. Redundant verticals (unchanged y) are skipped. */
export function stepPath(pts: Pt[]): string {
  if (!pts.length) return "";
  let d = "M" + fmt(pts[0].x) + "," + fmt(pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    d += "L" + fmt(pts[i].x) + "," + fmt(pts[i - 1].y);
    if (pts[i].y !== pts[i - 1].y) d += "L" + fmt(pts[i].x) + "," + fmt(pts[i].y);
  }
  return d;
}

/** Closed band between two edges: upper left→right, lower right→left, Z. */
export function areaPath(upper: Pt[], lower: Pt[]): string {
  if (!upper.length || !lower.length) return "";
  const up = upper.map((p, i) => (i ? "L" : "M") + fmt(p.x) + "," + fmt(p.y)).join("");
  const down = [...lower].reverse().map((p) => "L" + fmt(p.x) + "," + fmt(p.y)).join("");
  return up + down + "Z";
}

/** Cumulative stacking for a CFD: one band per key (bottom-up in `order`),
 *  each point carrying the running [y0, y1] count interval at that ts. */
export function stackSeries<K extends string>(
  samples: { ts: number; counts: Record<K, number> }[],
  order: K[],
): { key: K; band: { ts: number; y0: number; y1: number }[] }[] {
  const bands = order.map((key) => ({ key, band: [] as { ts: number; y0: number; y1: number }[] }));
  for (const s of samples) {
    let acc = 0;
    for (const b of bands) {
      const n = s.counts[b.key] ?? 0;
      b.band.push({ ts: s.ts, y0: acc, y1: acc + n });
      acc += n;
    }
  }
  return bands;
}
