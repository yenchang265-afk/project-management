/* Repository: versions/releases. Same WriteResult pattern as repo/structure.ts.
   Membership lives on items.fix_version (metadata column, not an event —
   mirrors items.project_id). The release-state guard runs in the route, where
   the engine can derive member items. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export type VersionState = "unreleased" | "released" | "archived";

export interface VersionInfo {
  id: string;
  projectId: string;
  name: string;
  releaseDate: string | null; // YYYY-MM-DD
  state: VersionState;
  itemCount: number;
}

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

/** mysql2 hydrates DATE as local-midnight Date — format with local parts. */
function dateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

export async function listVersions(projectId: string): Promise<VersionInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT v.id, v.project_id, v.name, v.release_date, v.state, COUNT(i.id) AS item_count
       FROM versions v LEFT JOIN items i ON i.fix_version = v.id
      WHERE v.project_id = ?
      GROUP BY v.id
      ORDER BY v.release_date IS NULL, v.release_date, v.name`, [projectId]);
  return rows.map((r) => ({
    id: r.id, projectId: r.project_id, name: r.name,
    releaseDate: dateStr(r.release_date), state: r.state as VersionState,
    itemCount: Number(r.item_count),
  }));
}

export async function createVersion(
  projectId: string, name: string, releaseDate: string | null,
): Promise<WriteResult> {
  const [p] = await pool().query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ?", [projectId]);
  if (!p[0]) return { ok: false, error: "Project not found." };
  const id = `ver-${slug(name)}-${slug(projectId.replace(/^prj-/, ""))}`;
  try {
    await pool().query(
      "INSERT INTO versions (id, project_id, name, release_date) VALUES (?, ?, ?, ?)",
      [id, projectId, name, releaseDate]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A version named "${name}" already exists in this project.` };
    throw e;
  }
}

export interface VersionPatch {
  name?: string;
  releaseDate?: string | null;
  state?: VersionState;
}

export async function getVersion(id: string): Promise<VersionInfo | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT v.id, v.project_id, v.name, v.release_date, v.state, COUNT(i.id) AS item_count
       FROM versions v LEFT JOIN items i ON i.fix_version = v.id
      WHERE v.id = ? GROUP BY v.id`, [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, projectId: r.project_id, name: r.name,
    releaseDate: dateStr(r.release_date), state: r.state as VersionState,
    itemCount: Number(r.item_count),
  };
}

export async function updateVersion(id: string, patch: VersionPatch): Promise<WriteResult> {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name); }
  if (patch.releaseDate !== undefined) { sets.push("release_date = ?"); args.push(patch.releaseDate); }
  if (patch.state !== undefined) { sets.push("state = ?"); args.push(patch.state); }
  if (sets.length === 0) return { ok: false, error: "Empty patch." };
  try {
    const [r] = await pool().query<ResultSetHeader>(
      `UPDATE versions SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    if (r.affectedRows === 0) return { ok: false, error: "Version not found." };
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A version named "${patch.name}" already exists in this project.` };
    throw e;
  }
}

export async function deleteVersion(id: string): Promise<WriteResult> {
  // items.fix_version FK is ON DELETE SET NULL — members fall out of the release
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM versions WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Version not found." };
  return { ok: true, id };
}

/** Assign/clear an item's fix version. The version must belong to the item's
 *  project (cross-project releases would dodge the project's release hub). */
export async function assignItemVersion(itemId: string, versionId: string | null): Promise<WriteResult> {
  if (versionId !== null) {
    const [rows] = await pool().query<RowDataPacket[]>(
      `SELECT v.project_id AS vproj, i.project_id AS iproj
         FROM versions v, items i WHERE v.id = ? AND i.id = ?`, [versionId, itemId]);
    const r = rows[0];
    if (!r) return { ok: false, error: "Item or version not found." };
    if (r.vproj !== r.iproj) return { ok: false, error: "Version belongs to a different project." };
  }
  const [r] = await pool().query<ResultSetHeader>(
    "UPDATE items SET fix_version = ? WHERE id = ?", [versionId, itemId]);
  if (r.affectedRows === 0) return { ok: false, error: "Item not found." };
  return { ok: true, id: itemId };
}

/** Member item ids of a version (the route derives their spine positions). */
export async function versionItemIds(versionId: string): Promise<string[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id FROM items WHERE fix_version = ? ORDER BY id", [versionId]);
  return rows.map((r) => r.id);
}
