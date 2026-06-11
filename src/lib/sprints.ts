/* Pure sprint helpers — no DB, no React. Used by the sprints repo (id minting)
   and by TeamSpace (picker merge logic), and unit-tested directly.

   Sprints are a first-class REGISTRY (sprints table per team); the work-item
   `sprint` field stays a free-text STRING. The picker merges both worlds. */

export type SprintState = "future" | "active" | "closed";

/** Same slug style as repo/structure.ts: lowercase, runs of non-alphanumerics
 *  collapse to "-", trimmed, capped at 24 chars per part. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

/** Registry sprint id: "spr-" + slug(name) + "-" + team suffix, so the same
 *  sprint name on two teams never collides. Worst case 4+24+1+24 = 53 ≤ VARCHAR(64). */
export function sprintIdFor(teamId: string, name: string): string {
  const suffix = slug(teamId.replace(/^team-/, ""));
  return "spr-" + slug(name) + "-" + suffix;
}

/** Picker options: registry sprints first (registry order), then any distinct
 *  work-item sprint strings not already registered, sorted (the pre-registry
 *  behavior). Blank/null WI sprints are ignored. */
export function mergeSprintNames(registry: string[], wiSprints: (string | null | undefined)[]): string[] {
  const out = [...new Set(registry)];
  const seen = new Set(out);
  const extras = [...new Set(wiSprints.filter((s): s is string => !!s && !seen.has(s)))].sort();
  return out.concat(extras);
}

/** Default picker selection: the active registry sprint if it's an option,
 *  else the last merged option (matches the old "latest sprint" default). */
export function pickDefaultSprint(
  registry: { name: string; state: SprintState }[],
  options: string[],
): string | null {
  const active = registry.find((s) => s.state === "active");
  if (active && options.includes(active.name)) return active.name;
  return options[options.length - 1] ?? null;
}
