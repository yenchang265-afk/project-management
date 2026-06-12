/* =========================================================================
   Goals — pure progress fold (no React/DOM/DB). A goal's progress is the
   mean of its member items' spine positions relative to `released`:
   1.0 = every member at/past released, off-spine members count as 0.
   ========================================================================= */

import { STATES, deriveItem, type Item } from "./engine";

const RELEASED_SPINE = STATES.released.spine!;

export function goalProgress(members: Item[]): number {
  if (!members.length) return 0;
  let sum = 0;
  for (const item of members) {
    const spine = STATES[deriveItem(item).state].spine;
    if (spine == null) continue; // off-spine (rejected/deferred/rolled_back) = 0
    sum += Math.min(1, spine / RELEASED_SPINE);
  }
  return sum / members.length;
}
