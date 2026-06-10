/* Repository: the project/team/user hierarchy (read side — admin CRUD is Phase 3). */
import type { RowDataPacket } from "mysql2/promise";
import type { Role } from "@/lib/engine";
import { pool } from "../db";

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
