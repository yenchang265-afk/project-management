/* Repository: webhook registrations. The secret is generated server-side and
   returned once at creation (only used for HMAC signatures afterwards). */
import { randomBytes, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";

export interface WebhookInfo {
  id: string;
  url: string;
  kinds: string[];   // event types; ["*"] = all
  failures: number;
  disabled: boolean;
}

export interface WebhookTarget extends WebhookInfo {
  secret: string;    // internal — only the dispatcher reads this
}

const DISABLE_AFTER = 10;

function toInfo(r: RowDataPacket): WebhookInfo {
  return {
    id: r.id, url: r.url,
    kinds: String(r.kinds).split(",").map((s) => s.trim()).filter(Boolean),
    failures: Number(r.failures), disabled: !!r.disabled,
  };
}

export async function listWebhooks(): Promise<WebhookInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, url, kinds, failures, disabled FROM webhooks ORDER BY created_at, id");
  return rows.map(toInfo);
}

/** Enabled hooks whose kind filter matches the event type. */
export async function webhookTargets(kind: string): Promise<WebhookTarget[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, url, kinds, secret, failures, disabled FROM webhooks WHERE disabled = 0");
  return rows.map((r) => ({ ...toInfo(r), secret: r.secret }))
    .filter((h) => h.kinds.includes("*") || h.kinds.includes(kind));
}

export async function createWebhook(
  url: string, kinds: string[],
): Promise<{ id: string; secret: string }> {
  const id = "wh-" + randomUUID();
  const secret = randomBytes(24).toString("hex");
  await pool().query(
    "INSERT INTO webhooks (id, url, kinds, secret) VALUES (?, ?, ?, ?)",
    [id, url, kinds.length ? kinds.join(",") : "*", secret]);
  return { id, secret };
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM webhooks WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

/** Success resets the failure streak; failure increments it and flips
 *  `disabled` once the streak reaches the threshold (dead-letter). */
export async function recordWebhookResult(id: string, ok: boolean): Promise<void> {
  if (ok) {
    await pool().query("UPDATE webhooks SET failures = 0 WHERE id = ?", [id]);
    return;
  }
  // MariaDB SET evaluates left-to-right with already-updated values, so
  // `failures` here is the incremented streak.
  await pool().query(
    "UPDATE webhooks SET failures = failures + 1, disabled = (failures >= ?) WHERE id = ?",
    [DISABLE_AFTER, id]);
}
