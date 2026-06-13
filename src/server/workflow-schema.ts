/* Wire validation for workflow-scheme transitions (G-13). Kept out of the route
   files because Next.js route modules may only export HTTP handlers — a shared
   zod schema exported from a route breaks the production build. Structural
   invariants (spine reachability, gate placement) are re-checked in the repo
   via validateWorkflow. */
import { z } from "zod";
import { STATES, type StateKey } from "@/lib/engine";

const stateKeys = Object.keys(STATES) as [StateKey, ...StateKey[]];

export const TransitionWireSchema = z.object({
  from: z.enum(stateKeys),
  to: z.enum(stateKeys),
  roles: z.array(z.enum(["PM", "Dev"])).min(1).max(2),
  kind: z.enum(["forward", "rework", "terminal", "recovery", "hotfix"]),
  label: z.string().min(1).max(80),
  gate: z.enum(["ready_for_dev", "release"]).optional(),
  needsReason: z.enum(["reject", "free"]).optional(),
}).strict();
