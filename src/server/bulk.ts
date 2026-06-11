/* Bulk command execution — the body of POST /api/items/bulk.
   Ops run SEQUENTIALLY; each op is scope-checked then version-checked exactly
   like the single-command route. Partial success is expected: the caller gets
   one result per op and reconciles by refetching items. */
import type { PdlcEvent } from "@/lib/engine";
import type { AuthedUser } from "./auth";
import type { BulkOp } from "./commands";
import { notifyAfterCommand } from "./notify";
import { applyCommand, getItem } from "./repo/items";
import { getScope, itemInScope } from "./scope";

export interface BulkOpResult {
  itemId: string;
  status: "ok" | "stale" | "rejected" | "not_found";
  version?: number;     // ok: new version · stale: the fresh version to reconcile against
  event?: PdlcEvent;    // ok only
  error?: string;       // rejected/not_found
}

export async function runBulkOps(user: AuthedUser, ops: BulkOp[]): Promise<BulkOpResult[]> {
  const scope = await getScope(user);
  const results: BulkOpResult[] = [];
  for (const op of ops) {
    // access gate: out-of-scope items are indistinguishable from missing ones
    const found = await getItem(op.itemId);
    if (!found || !itemInScope(found.item.project ?? null, scope)) {
      results.push({ itemId: op.itemId, status: "not_found", error: "Item not found." });
      continue;
    }
    // actor identity comes from the session — never from the request body
    const out = await applyCommand(op.itemId, op.expectedVersion, op.command, user.name, user.role);
    switch (out.status) {
      case "ok":
        // best-effort fan-out: watchers/@mentions — never blocks or fails the op
        void notifyAfterCommand(found.item, out.event);
        results.push({ itemId: op.itemId, status: "ok", version: out.version, event: out.event });
        break;
      case "stale":
        results.push({ itemId: op.itemId, status: "stale", version: out.version });
        break;
      case "rejected":
        results.push({ itemId: op.itemId, status: "rejected", error: out.result.error });
        break;
      case "not_found":
        results.push({ itemId: op.itemId, status: "not_found", error: "Item not found." });
        break;
    }
  }
  return results;
}
