/* Repository: the per-team sprint registry (first-class sprints).
   Same WriteResult pattern as repo/structure.ts — expectable conflicts
   (duplicates, missing rows) come back as {ok:false,error} for 422 mapping.
   Work items keep their free-text `sprint` string; this table is metadata. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { sprintIdFor, type SprintState } from "@/lib/sprints";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export interface SprintInfo {
  id: string; teamId: string; name: string;
  start: string | null;   // YYYY-MM-DD
  end: string | null;     // YYYY-MM-DD
  state: SprintState;
}

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

/** mysql2 hydrates DATE columns as local-midnight Date objects; format with
 *  local parts (NOT toISOString, which can shift a day across UTC offsets). */
function dateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function toInfo(r: RowDataPacket): SprintInfo {
  return {
    id: r.id, teamId: r.team_id, name: r.name,
    start: dateStr(r.start_date), end: dateStr(r.end_date),
    state: r.state as SprintState,
  };
}

export async function listSprints(teamId: string): Promise<SprintInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT id, team_id, name, start_date, end_date, state
       FROM sprints WHERE team_id = ?
      ORDER BY start_date IS NULL, start_date, created_at, name`, [teamId]);
  return rows.map(toInfo);
}

export async function createSprint(
  teamId: string, name: string, start: string | null, end: string | null,
): Promise<WriteResult> {
  const [t] = await pool().query<RowDataPacket[]>("SELECT id FROM teams WHERE id = ?", [teamId]);
  if (!t[0]) return { ok: false, error: "Team not found." };
  const id = sprintIdFor(teamId, name);
  try {
    await pool().query(
      "INSERT INTO sprints (id, team_id, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)",
      [id, teamId, name, start, end]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A sprint named "${name}" already exists for this team.` };
    throw e;
  }
}

export interface SprintPatch {
  name?: string;
  start?: string | null;
  end?: string | null;
  state?: SprintState;
}

export async function updateSprint(id: string, patch: SprintPatch): Promise<WriteResult> {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name); }
  if (patch.start !== undefined) { sets.push("start_date = ?"); args.push(patch.start); }
  if (patch.end !== undefined) { sets.push("end_date = ?"); args.push(patch.end); }
  if (patch.state !== undefined) { sets.push("state = ?"); args.push(patch.state); }
  if (sets.length === 0) return { ok: false, error: "Empty patch." };
  try {
    const [r] = await pool().query<ResultSetHeader>(
      `UPDATE sprints SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    if (r.affectedRows === 0) return { ok: false, error: "Sprint not found." };
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A sprint named "${patch.name}" already exists for this team.` };
    throw e;
  }
}

/** Read-side guard helper for GET /api/teams/:id/sprints (member or PM). */
export async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]);
  return !!rows[0];
}
