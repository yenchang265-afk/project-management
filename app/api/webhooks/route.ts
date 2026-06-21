import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { createWebhook, listWebhooks } from "@/server/repo/webhooks";

function isPrivateUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return /^(localhost|127\.|::1|0\.0\.0\.0|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(host);
  } catch { return true; }
}

const CreateWebhookSchema = z.object({
  url: z.string().url().max(500)
    .refine((u) => /^https?:\/\//.test(u), "Only http(s) URLs.")
    .refine((u) => !isPrivateUrl(u), "Webhook URLs must not target private or loopback addresses."),
  kinds: z.array(z.string().min(1).max(40)).max(30).optional(), // omit = all events
}).strict();

/** GET /api/webhooks — registrations (never the secret). PM only. */
export const GET = withAuth(async (_req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const webhooks = await listWebhooks();
  return NextResponse.json({ success: true, data: { webhooks } });
});

/** POST /api/webhooks — register a hook. The response carries the signing
 *  secret ONCE; deliveries are HMAC-SHA256-signed with it. PM only. */
export const POST = withAuth(async (req, user) => {
  const guard = requirePerm(user, "manage_metadata");
  if (guard) return guard;
  const body = await parseBody(req, CreateWebhookSchema);
  if (!body.ok) return body.res;
  const r = await createWebhook(body.data.url, body.data.kinds ?? []);
  return NextResponse.json({ success: true, data: { id: r.id, secret: r.secret } });
});
