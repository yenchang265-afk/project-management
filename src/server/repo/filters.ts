/* Repository: saved CQL filters. Same WriteResult pattern as repo/structure.ts —
   expectable conflicts (duplicate names, missing rows, foreign owner) come back
   as {ok:false,error} for 422 mapping. Reads return the caller's own filters
   plus everyone's shared ones. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export interface FilterInfo {
  id: string;
  ownerId: string;
  name: string;
  cql: string;
  shared: boolean;
}

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

function toInfo(r: RowDataPacket): FilterInfo {
  return { id: r.id, ownerId: r.owner_id, name: r.name, cql: r.cql, shared: !!r.shared };
}

/** The caller's own filters + everyone's shared ones, alphabetical. */
export async function listFilters(userId: string): Promise<FilterInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT id, owner_id, name, cql, shared
       FROM filters WHERE owner_id = ? OR shared = 1
      ORDER BY name, id`, [userId]);
  return rows.map(toInfo);
}

export async function createFilter(
  ownerId: string, name: string, cql: string, shared: boolean,
): Promise<WriteResult> {
  // owner suffix keeps ids unique when two users pick the same filter name
  const id = `flt-${slug(name)}-${ownerId.slice(0, 8)}`;
  try {
    await pool().query(
      "INSERT INTO filters (id, owner_id, name, cql, shared) VALUES (?, ?, ?, ?, ?)",
      [id, ownerId, name, cql, shared ? 1 : 0]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `You already have a filter named "${name}".` };
    throw e;
  }
}

/** Owner-only delete: someone else's id behaves like a missing row. */
export async function deleteFilter(id: string, ownerId: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>(
    "DELETE FROM filters WHERE id = ? AND owner_id = ?", [id, ownerId]);
  if (r.affectedRows === 0) return { ok: false, error: "Filter not found." };
  return { ok: true, id };
}
