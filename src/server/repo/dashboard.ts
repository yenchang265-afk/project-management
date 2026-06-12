/* Repository: per-user dashboard gadget preferences (an ordered list of
   gadget kinds). The client owns the registry; unknown kinds are dropped at
   render time so stale prefs survive gadget renames. */
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db";

export async function getDashboardPrefs(userId: string): Promise<string[] | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT gadgets FROM dashboard_prefs WHERE user_id = ?", [userId]);
  if (!rows[0]) return null;
  try {
    const parsed: unknown = JSON.parse(rows[0].gadgets);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch { return null; } // corrupted row falls back to the default layout
}

export async function setDashboardPrefs(userId: string, gadgets: string[]): Promise<void> {
  await pool().query(
    "INSERT INTO dashboard_prefs (user_id, gadgets) VALUES (?, ?) ON DUPLICATE KEY UPDATE gadgets = VALUES(gadgets)",
    [userId, JSON.stringify(gadgets)]);
}
