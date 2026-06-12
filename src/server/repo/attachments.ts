/* Repository: attachment metadata. Bytes live on disk (handled by the route);
   these rows are the source of truth for what exists and who may delete it.
   Same WriteResult pattern as repo/structure.ts. */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export interface AttachmentInfo {
  id: string;
  itemId: string;
  wiId: string | null;
  filename: string;
  mime: string;
  size: number;
  uploader: string;
}

function toInfo(r: RowDataPacket): AttachmentInfo {
  return {
    id: r.id, itemId: r.item_id, wiId: r.wi_id ?? null,
    filename: r.filename, mime: r.mime, size: Number(r.size), uploader: r.uploader,
  };
}

export async function listAttachments(itemId: string, wiId?: string): Promise<AttachmentInfo[]> {
  const sql = wiId
    ? "SELECT * FROM attachments WHERE item_id = ? AND wi_id = ? ORDER BY created_at, id"
    : "SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at, id";
  const [rows] = await pool().query<RowDataPacket[]>(sql, wiId ? [itemId, wiId] : [itemId]);
  return rows.map(toInfo);
}

export async function getAttachment(id: string): Promise<AttachmentInfo | null> {
  const [rows] = await pool().query<RowDataPacket[]>("SELECT * FROM attachments WHERE id = ?", [id]);
  return rows[0] ? toInfo(rows[0]) : null;
}

export async function createAttachment(
  itemId: string, wiId: string | null, filename: string, mime: string, size: number, uploader: string,
): Promise<WriteResult> {
  const [it] = await pool().query<RowDataPacket[]>("SELECT id FROM items WHERE id = ?", [itemId]);
  if (!it[0]) return { ok: false, error: "Item not found." };
  const id = "att-" + randomUUID();
  await pool().query(
    "INSERT INTO attachments (id, item_id, wi_id, filename, mime, size, uploader) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, itemId, wiId, filename, mime, size, uploader]);
  return { ok: true, id };
}

export async function deleteAttachment(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM attachments WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Attachment not found." };
  return { ok: true, id };
}
