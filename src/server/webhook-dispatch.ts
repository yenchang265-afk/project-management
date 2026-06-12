/* Webhook dispatcher: fire-and-forget POSTs after an event is appended.
   Never blocks or fails the command — callers `void` this. Each delivery is
   HMAC-SHA256-signed with the per-hook secret so receivers can verify
   authenticity; one retry, 5s timeout, dead-letter via recordWebhookResult. */
import { createHmac } from "node:crypto";
import type { PdlcEvent } from "@/lib/engine";
import { recordWebhookResult, webhookTargets, type WebhookTarget } from "./repo/webhooks";

const TIMEOUT_MS = 5_000;

async function deliver(hook: WebhookTarget, body: string, kind: string): Promise<boolean> {
  const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cadence-Event": kind,
          "X-Cadence-Signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return true;
    } catch { /* network/timeout — fall through to retry */ }
  }
  return false;
}

/** POST the event to every enabled hook whose kind filter matches. */
export async function fireWebhooks(event: PdlcEvent): Promise<void> {
  let hooks: WebhookTarget[];
  try { hooks = await webhookTargets(event.type); } catch { return; }
  if (!hooks.length) return;
  const body = JSON.stringify({ event });
  await Promise.all(hooks.map(async (h) => {
    // PM-registered URLs only; scheme is validated at registration. Dev-grade:
    // no egress filtering — don't point hooks at internal services you
    // wouldn't trust a PM to reach.
    const ok = await deliver(h, body, event.type);
    await recordWebhookResult(h.id, ok).catch(() => { /* best-effort */ });
  }));
}
