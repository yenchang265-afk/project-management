/* Repository: global audit log — a paginated read over the append-only events
   table (every item's history is already there; this is just the cross-item
   read-side). No writes ever. Pagination is seq-keyed (newest first) so rows
   can't shift between pages while new events append. */
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db";

export interface AuditRow {
  seq: number;
  itemId: string;
  type: string;
  actor: string;
  role: string;
  ts: number;
}

export interface AuditQuery {
  actor?: string;     // exact match
  type?: string;      // exact event type
  itemId?: string;    // exact item
  beforeSeq?: number; // page cursor: rows with seq < beforeSeq
  limit?: number;     // 1..200, default 50
}

export async function listAuditEvents(q: AuditQuery): Promise<AuditRow[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.actor) { where.push("actor = ?"); args.push(q.actor); }
  if (q.type) { where.push("type = ?"); args.push(q.type); }
  if (q.itemId) { where.push("item_id = ?"); args.push(q.itemId); }
  if (q.beforeSeq != null) { where.push("seq < ?"); args.push(q.beforeSeq); }
  const limit = Math.max(1, Math.min(200, q.limit ?? 50));
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT seq, item_id, type, actor, role, ts FROM events
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY seq DESC LIMIT ${limit}`, args);
  return rows.map((r) => ({
    seq: Number(r.seq), itemId: r.item_id, type: r.type, actor: r.actor, role: r.role, ts: Number(r.ts),
  }));
}
