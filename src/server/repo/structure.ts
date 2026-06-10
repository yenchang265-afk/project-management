/* Repository: the project/team/user hierarchy — reads + Phase 3 admin writes.
   Writes return {ok:false,error} for expectable conflicts (duplicates, missing rows)
   so routes can map them to 422 without string-matching SQL errors. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Role } from "@/lib/engine";
import { pool } from "../db";

export type WriteResult = { ok: true; id: string } | { ok: false; error: string };

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

export interface ProjectInfo {
  id: string; key: string; name: string; description: string | null; teamIds: string[];
}
export interface TeamMemberInfo { id: string; name: string; role: Role; }
export interface TeamInfo {
  id: string; name: string; members: TeamMemberInfo[]; projectIds: string[];
}
export interface Structure { projects: ProjectInfo[]; teams: TeamInfo[]; }

export async function getStructure(): Promise<Structure> {
  const [projRows] = await pool().query<RowDataPacket[]>(
    "SELECT id, `key`, name, description FROM projects ORDER BY name");
  const [teamRows] = await pool().query<RowDataPacket[]>(
    "SELECT id, name FROM teams ORDER BY name");
  const [ptRows] = await pool().query<RowDataPacket[]>(
    "SELECT project_id, team_id FROM project_teams");
  const [tmRows] = await pool().query<RowDataPacket[]>(
    `SELECT tm.team_id, u.id, u.name, u.role
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      ORDER BY u.name`);

  const teamsByProject = new Map<string, string[]>();
  const projectsByTeam = new Map<string, string[]>();
  for (const r of ptRows) {
    if (!teamsByProject.has(r.project_id)) teamsByProject.set(r.project_id, []);
    teamsByProject.get(r.project_id)!.push(r.team_id);
    if (!projectsByTeam.has(r.team_id)) projectsByTeam.set(r.team_id, []);
    projectsByTeam.get(r.team_id)!.push(r.project_id);
  }
  const membersByTeam = new Map<string, TeamMemberInfo[]>();
  for (const r of tmRows) {
    if (!membersByTeam.has(r.team_id)) membersByTeam.set(r.team_id, []);
    membersByTeam.get(r.team_id)!.push({ id: r.id, name: r.name, role: r.role as Role });
  }

  return {
    projects: projRows.map((p) => ({
      id: p.id, key: p.key, name: p.name, description: p.description,
      teamIds: teamsByProject.get(p.id) || [],
    })),
    teams: teamRows.map((t) => ({
      id: t.id, name: t.name,
      members: membersByTeam.get(t.id) || [],
      projectIds: projectsByTeam.get(t.id) || [],
    })),
  };
}

export interface UserInfo { id: string; name: string; role: Role; }

export async function getUsers(): Promise<UserInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>("SELECT id, name, role FROM users ORDER BY name");
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role as Role }));
}

/* ---------- Phase 3 admin writes (PM-only — enforced in the routes) ---------- */

export async function createProject(key: string, name: string, description: string | null): Promise<WriteResult> {
  const id = "prj-" + slug(name);
  try {
    await pool().query(
      "INSERT INTO projects (id, `key`, name, description) VALUES (?, ?, ?, ?)",
      [id, key.toUpperCase(), name, description]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A project with that name or key already exists.` };
    throw e;
  }
}

export async function createTeam(name: string): Promise<WriteResult> {
  const id = "team-" + slug(name);
  try {
    await pool().query("INSERT INTO teams (id, name) VALUES (?, ?)", [id, name]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A team named "${name}" already exists.` };
    throw e;
  }
}

export async function addTeamMember(teamId: string, userId: string): Promise<WriteResult> {
  try {
    const [r] = await pool().query<ResultSetHeader>(
      "INSERT INTO team_members (team_id, user_id) SELECT ?, id FROM users WHERE id = ?", [teamId, userId]);
    if (r.affectedRows === 0) return { ok: false, error: "User not found." };
    return { ok: true, id: userId };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: "Already a member of this team." };
    throw e;
  }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]);
  if (r.affectedRows === 0) return { ok: false, error: "Not a member of this team." };
  return { ok: true, id: userId };
}

export async function addProjectTeam(teamId: string, projectId: string): Promise<WriteResult> {
  try {
    const [r] = await pool().query<ResultSetHeader>(
      "INSERT INTO project_teams (project_id, team_id) SELECT id, ? FROM projects WHERE id = ?", [teamId, projectId]);
    if (r.affectedRows === 0) return { ok: false, error: "Project not found." };
    return { ok: true, id: projectId };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: "This team already owns that project." };
    throw e;
  }
}

export async function removeProjectTeam(teamId: string, projectId: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>(
    "DELETE FROM project_teams WHERE team_id = ? AND project_id = ?", [teamId, projectId]);
  if (r.affectedRows === 0) return { ok: false, error: "This team doesn't own that project." };
  return { ok: true, id: projectId };
}

/** Assign (or clear) an item's owning project. Direct column update — project
 *  membership is item metadata, not lifecycle, so it doesn't enter the event log. */
export async function assignItemProject(itemId: string, projectId: string | null): Promise<WriteResult> {
  if (projectId != null) {
    const [p] = await pool().query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ?", [projectId]);
    if (!p[0]) return { ok: false, error: "Project not found." };
  }
  const [r] = await pool().query<ResultSetHeader>(
    "UPDATE items SET project_id = ? WHERE id = ?", [projectId, itemId]);
  if (r.affectedRows === 0) return { ok: false, error: "Item not found." };
  return { ok: true, id: itemId };
}
