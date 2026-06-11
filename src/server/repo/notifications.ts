/* Repository: notifications (watchers + @mention fan-out). SQL lives here only.
   Reads/writes are always scoped to ONE user — a user can never list or mark
   another user's notifications. */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db";

export interface NotificationInfo {
  id: string;
  itemId: string | null;
  kind: string;
  message: string;
  readAt: string | null;     // ISO timestamp once read
  createdAt: string;
}

export interface NotificationDraft {
  userId: string;
  itemId: string | null;
  kind: string;
  message: string;
}

function rowToInfo(r: RowDataPacket): NotificationInfo {
  return {
    id: r.id, itemId: r.item_id ?? null, kind: r.kind, message: r.message,
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** A user's own notifications, newest first (capped — it's a bell dropdown, not an archive). */
export async function listNotifications(
  userId: string, opts: { unreadOnly?: boolean } = {},
): Promise<NotificationInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT id, item_id, kind, message, read_at, created_at FROM notifications
      WHERE user_id = ?${opts.unreadOnly ? " AND read_at IS NULL" : ""}
      ORDER BY created_at DESC, id DESC LIMIT 100`, [userId]);
  return rows.map(rowToInfo);
}

/** Mark the user's OWN notifications read; ids belonging to other users are ignored. */
export async function markRead(userId: string, ids: string[] | "all"): Promise<void> {
  if (ids === "all") {
    await pool().query(
      "UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL", [userId]);
    return;
  }
  if (ids.length === 0) return;
  await pool().query(
    "UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL AND id IN (?)",
    [userId, ids]);
}

/** Batch insert (one statement). Messages are clamped to the column width. */
export async function createNotifications(rows: NotificationDraft[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) => [randomUUID(), r.userId, r.itemId, r.kind, r.message.slice(0, 300)]);
  await pool().query(
    "INSERT INTO notifications (id, user_id, item_id, kind, message) VALUES ?", [values]);
}
