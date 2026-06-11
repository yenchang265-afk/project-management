/* Access scoping: a user's visibility follows the hierarchy through their team
   memberships — Company → Org → Team → Project → Item. Admins (PM role) are
   unrestricted; everyone else sees only what their team memberships reach.
   Enforced server-side on every read/write surface, not just in the UI. */
import type { RowDataPacket } from "mysql2/promise";
import type { AuthedUser } from "./auth";
import type { Structure } from "./repo/structure";
import { pool } from "./db";

export interface Scope {
  all: boolean;                 // PM/admin: unrestricted
  teamIds: Set<string>;
  orgIds: Set<string>;
  projectIds: Set<string>;
}

export async function getScope(user: AuthedUser): Promise<Scope> {
  if (user.role === "PM")
    return { all: true, teamIds: new Set(), orgIds: new Set(), projectIds: new Set() };

  // non-admin: derive the reachable set from the user's team memberships
  const [teamRows] = await pool().query<RowDataPacket[]>(
    `SELECT t.id, t.org_id
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?`, [user.id]);
  const teamIds = new Set<string>(), orgIds = new Set<string>();
  for (const r of teamRows) { teamIds.add(r.id); if (r.org_id) orgIds.add(r.org_id); }

  const projectIds = new Set<string>();
  if (teamIds.size) {
    const ph = [...teamIds].map(() => "?").join(",");
    const [ptRows] = await pool().query<RowDataPacket[]>(
      `SELECT DISTINCT project_id FROM project_teams WHERE team_id IN (${ph})`, [...teamIds]);
    for (const r of ptRows) projectIds.add(r.project_id);
  }
  return { all: false, teamIds, orgIds, projectIds };
}

/** True if the item (by its owning project) is visible to this scope. */
export function itemInScope(projectId: string | null, scope: Scope): boolean {
  return scope.all || (projectId != null && scope.projectIds.has(projectId));
}

/** Trim a full Structure down to what the scope can see. Cross-references are
 *  also filtered so an org never lists a team the user can't see, etc.
 *  Orgs are an exception: the org DIRECTORY (name + team ids) is visible to
 *  everyone so users can discover/search other orgs — but a non-member org's
 *  teams stay hidden (its teamIds point at teams absent from `teams`), so no
 *  member/project/item detail leaks through it. */
export function scopeStructure(s: Structure, scope: Scope): Structure {
  if (scope.all) return s;
  return {
    orgs: s.orgs, // full directory; detail beyond names/counts resolves only for member orgs
    projects: s.projects
      .filter((p) => scope.projectIds.has(p.id))
      .map((p) => ({ ...p, teamIds: p.teamIds.filter((t) => scope.teamIds.has(t)) })),
    teams: s.teams
      .filter((t) => scope.teamIds.has(t.id))
      .map((t) => ({ ...t, projectIds: t.projectIds.filter((p) => scope.projectIds.has(p)) })),
  };
}
