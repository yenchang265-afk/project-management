/* Repository: announcements scoped to company / org / team.
   Reads are filtered to a user's Scope; writes are PM-only (enforced in routes). */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { Scope } from "../scope";

export type AnnouncementScope = "company" | "org" | "team";

export interface AnnouncementInfo {
  id: string;
  scopeType: AnnouncementScope;
  scopeId: string | null;
  title: string;
  body: string | null;
  author: string;
  createdAt: string;
}

function rowToInfo(r: RowDataPacket): AnnouncementInfo {
  return {
    id: r.id, scopeType: r.scope_type, scopeId: r.scope_id ?? null,
    title: r.title, body: r.body ?? null, author: r.author,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Announcements visible to a scope: company-wide always, plus the user's own
 *  orgs and teams. Admins (scope.all) see everything. Newest first. */
export async function getAnnouncements(scope: Scope): Promise<AnnouncementInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, scope_type, scope_id, title, body, author, created_at FROM announcements ORDER BY created_at DESC");
  return rows
    .filter((r) => {
      if (r.scope_type === "company") return true;
      if (scope.all) return true;
      if (r.scope_type === "org") return scope.orgIds.has(r.scope_id);
      if (r.scope_type === "team") return scope.teamIds.has(r.scope_id);
      return false;
    })
    .map(rowToInfo);
}

export type WriteResult = { ok: true; id: string } | { ok: false; error: string };

export async function createAnnouncement(
  scopeType: AnnouncementScope, scopeId: string | null, title: string, body: string | null, author: string,
): Promise<WriteResult> {
  // validate the target exists (company needs no target)
  if (scopeType === "org" || scopeType === "team") {
    if (!scopeId) return { ok: false, error: "A target is required for org/team announcements." };
    const table = scopeType === "org" ? "organizations" : "teams";
    const [t] = await pool().query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [scopeId]);
    if (!t[0]) return { ok: false, error: `${scopeType === "org" ? "Organization" : "Team"} not found.` };
  }
  const id = randomUUID();
  await pool().query(
    "INSERT INTO announcements (id, scope_type, scope_id, title, body, author) VALUES (?, ?, ?, ?, ?, ?)",
    [id, scopeType, scopeType === "company" ? null : scopeId, title, body, author]);
  return { ok: true, id };
}

export async function deleteAnnouncement(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM announcements WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Announcement not found." };
  return { ok: true, id };
}
