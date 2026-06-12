/* Email channel for notifications — entirely optional: without SMTP_URL in
   the environment this whole module is a no-op. Recipients are double-gated:
   the server flag AND the user's own email_enabled preference. Best-effort
   like every other fan-out — never throws into the caller. */
import nodemailer, { type Transporter } from "nodemailer";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "./db";
import type { NotificationDraft } from "./repo/notifications";

let transport: Transporter | null | undefined; // undefined = not initialized yet

function mailer(): Transporter | null {
  if (transport !== undefined) return transport;
  const url = process.env.SMTP_URL;
  transport = url ? nodemailer.createTransport(url) : null;
  return transport;
}

/** Of the given users, those who opted in to email — with their addresses. */
async function emailRecipients(userIds: string[]): Promise<{ id: string; email: string }[]> {
  if (!userIds.length) return [];
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT u.id, u.email FROM users u
       JOIN notification_prefs p ON p.user_id = u.id AND p.email_enabled = 1
      WHERE u.id IN (${userIds.map(() => "?").join(",")})`, userIds);
  return rows.map((r) => ({ id: r.id, email: r.email }));
}

export async function emailNotifications(rows: NotificationDraft[]): Promise<void> {
  try {
    const t = mailer();
    if (!t || !rows.length) return;
    const recipients = await emailRecipients([...new Set(rows.map((r) => r.userId))]);
    if (!recipients.length) return;
    const byUser = new Map(recipients.map((r) => [r.id, r.email]));
    const from = process.env.MAIL_FROM || "cadence@localhost";
    await Promise.all(rows.flatMap((row) => {
      const to = byUser.get(row.userId);
      if (!to) return [];
      return [t.sendMail({
        from, to,
        subject: `[Cadence] ${row.itemId}: ${row.kind}`,
        text: row.message,
      }).catch((e: unknown) => {
        console.error("[mail] send failed:", e instanceof Error ? e.message : e);
      })];
    }));
  } catch (e) {
    console.error("[mail] channel failed:", e instanceof Error ? e.message : e);
  }
}

/* ---------- per-user preference ---------- */

export async function getEmailPref(userId: string): Promise<boolean> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT email_enabled FROM notification_prefs WHERE user_id = ?", [userId]);
  return !!rows[0]?.email_enabled;
}

export async function setEmailPref(userId: string, enabled: boolean): Promise<void> {
  await pool().query(
    "INSERT INTO notification_prefs (user_id, email_enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE email_enabled = VALUES(email_enabled)",
    [userId, enabled ? 1 : 0]);
}
