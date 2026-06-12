/* Repository: intake forms. The public token is the whole credential for
   submitting — generated server-side, listable only by PMs. */
import { randomBytes, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export interface FormInfo {
  id: string;
  itemId: string;
  name: string;
  publicToken: string;
  enabled: boolean;
}

function toInfo(r: RowDataPacket): FormInfo {
  return { id: r.id, itemId: r.item_id, name: r.name, publicToken: r.public_token, enabled: !!r.enabled };
}

export async function listForms(): Promise<FormInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, item_id, name, public_token, enabled FROM forms ORDER BY created_at, id");
  return rows.map(toInfo);
}

export async function createForm(itemId: string, name: string): Promise<WriteResult> {
  const [i] = await pool().query<RowDataPacket[]>("SELECT id FROM items WHERE id = ?", [itemId]);
  if (!i[0]) return { ok: false, error: "Item not found." };
  const id = "form-" + randomUUID();
  await pool().query(
    "INSERT INTO forms (id, item_id, name, public_token) VALUES (?, ?, ?, ?)",
    [id, itemId, name, randomBytes(24).toString("hex")]);
  return { ok: true, id };
}

export async function deleteForm(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM forms WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Form not found." };
  return { ok: true, id };
}

/** Resolve a public token to its (enabled) form — the submit route's gate. */
export async function formByToken(token: string): Promise<FormInfo | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, item_id, name, public_token, enabled FROM forms WHERE public_token = ? AND enabled = 1",
    [token]);
  return rows[0] ? toInfo(rows[0]) : null;
}
