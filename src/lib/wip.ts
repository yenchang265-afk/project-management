/* WIP limits for the kanban board (Jira parity — board WIP limits).
   Pure + tiny: a per-column cap that flags columns at or over capacity.
   Limits are board UI config (client-persisted), not lifecycle — they never
   block a transition, only warn, mirroring how Jira surfaces WIP breaches. */

export type WipLevel = "ok" | "at" | "over";

/** Map of column key → cap. 0 / absent / negative means "no limit". */
export type WipLimits = Record<string, number>;

export function wipLevel(count: number, limit: number | undefined): WipLevel {
  if (!limit || limit <= 0) return "ok";
  if (count > limit) return "over";
  if (count === limit) return "at";
  return "ok";
}

/** Columns whose count is strictly over their configured limit. */
export function overLimitColumns(counts: Record<string, number>, limits: WipLimits): string[] {
  return Object.keys(limits).filter((c) => wipLevel(counts[c] ?? 0, limits[c]) === "over");
}
