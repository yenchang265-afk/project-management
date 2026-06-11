/* Client-side API helpers — thin typed wrapper over fetch + the response envelope.
   A 401 anywhere redirects to /login (session expired or not signed in). */
import type { Item, PdlcEvent, Role } from "./engine";
import type { SprintState } from "./sprints";

export interface ApiUser { id: string; email: string; name: string; role: Role; }

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; data?: unknown };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    return { ok: false, status: 0, error: "Network error — is the server running?" };
  }
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
    return { ok: false, status: 401, error: "Not authenticated." };
  }
  let body: { success?: boolean; data?: unknown; error?: string } = {};
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok || !body.success)
    return { ok: false, status: res.status, error: body.error || `Request failed (${res.status}).`, data: body.data };
  return { ok: true, data: body.data as T };
}

export interface ProjectInfo {
  id: string; key: string; name: string; description: string | null; teamIds: string[];
}
export interface TeamMemberInfo { id: string; name: string; role: Role; }
export interface TeamInfo { id: string; name: string; orgId: string | null; members: TeamMemberInfo[]; projectIds: string[]; }
export interface OrgInfo { id: string; name: string; teamIds: string[]; }
export interface Structure { orgs: OrgInfo[]; projects: ProjectInfo[]; teams: TeamInfo[]; }

export type AnnouncementScope = "company" | "org" | "team";
export interface AnnouncementInfo {
  id: string; scopeType: AnnouncementScope; scopeId: string | null;
  title: string; body: string | null; author: string; createdAt: string;
}

export const fetchMe = () => call<{ user: ApiUser }>("/api/auth/me");
export const fetchItems = () => call<{ items: Item[]; versions: Record<string, number> }>("/api/items");
export const fetchStructure = () => call<Structure>("/api/structure");
export const logout = () => call<Record<string, never>>("/api/auth/logout", { method: "POST" });

export function postCommand(itemId: string, command: unknown, expectedVersion: number) {
  return call<{ event: PdlcEvent; version: number }>(`/api/items/${encodeURIComponent(itemId)}/commands`, {
    method: "POST",
    body: JSON.stringify({ command, expectedVersion }),
  });
}

export function postSpawn(spawnFrom: string, expectedVersion: number) {
  return call<{ child: Item; parentEvent: PdlcEvent; parentVersion: number }>("/api/items", {
    method: "POST",
    body: JSON.stringify({ spawnFrom, expectedVersion }),
  });
}

/* ---------- Phase 3 admin (PM-only server-side) ---------- */
export const fetchUsers = () => call<{ users: TeamMemberInfo[] }>("/api/users");

export const createProject = (key: string, name: string, description: string | null) =>
  call<{ id: string }>("/api/projects", { method: "POST", body: JSON.stringify({ key, name, description }) });

export const createTeam = (name: string) =>
  call<{ id: string }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) });

export const createOrg = (name: string) =>
  call<{ id: string }>("/api/orgs", { method: "POST", body: JSON.stringify({ name }) });

export const renameOrg = (id: string, name: string) =>
  call<Record<string, never>>(`/api/orgs/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ name }),
  });

export const deleteOrg = (id: string) =>
  call<Record<string, never>>(`/api/orgs/${encodeURIComponent(id)}`, { method: "DELETE" });

export const setTeamOrg = (teamId: string, orgId: string | null) =>
  call<Record<string, never>>(`/api/teams/${encodeURIComponent(teamId)}/org`, {
    method: "PATCH", body: JSON.stringify({ orgId }),
  });

export const fetchAnnouncements = () => call<{ announcements: AnnouncementInfo[] }>("/api/announcements");

export const createAnnouncement = (scopeType: AnnouncementScope, scopeId: string | null, title: string, body: string | null) =>
  call<{ id: string }>("/api/announcements", { method: "POST", body: JSON.stringify({ scopeType, scopeId, title, body }) });

export const deleteAnnouncement = (id: string) =>
  call<Record<string, never>>(`/api/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });

export const teamMemberOp = (teamId: string, userId: string, op: "add" | "remove") =>
  call<Record<string, never>>(`/api/teams/${encodeURIComponent(teamId)}/members`, {
    method: "POST", body: JSON.stringify({ userId, op }),
  });

export const teamProjectOp = (teamId: string, projectId: string, op: "add" | "remove") =>
  call<Record<string, never>>(`/api/teams/${encodeURIComponent(teamId)}/projects`, {
    method: "POST", body: JSON.stringify({ projectId, op }),
  });

export const assignItemProject = (itemId: string, projectId: string | null) =>
  call<Record<string, never>>(`/api/items/${encodeURIComponent(itemId)}/project`, {
    method: "PATCH", body: JSON.stringify({ projectId }),
  });

/* ---------- Notifications (watchers + @mentions; own rows only) ---------- */
export interface NotificationInfo {
  id: string; itemId: string | null; kind: string; message: string;
  readAt: string | null; createdAt: string;
}

export const fetchNotifications = () =>
  call<{ notifications: NotificationInfo[] }>("/api/notifications");

/** Mark notifications read; omit ids to mark ALL read. */
export const markNotificationsRead = (ids?: string[]) =>
  call<Record<string, never>>("/api/notifications", {
    method: "POST", body: JSON.stringify({ op: "read", ...(ids ? { ids } : {}) }),
  });

/* ---------- Sprint registry (work items keep their free-text sprint string) ---------- */
export interface SprintInfo {
  id: string; teamId: string; name: string;
  start: string | null; end: string | null;   // YYYY-MM-DD
  state: SprintState;
}

export const fetchSprints = (teamId: string) =>
  call<{ sprints: SprintInfo[] }>(`/api/teams/${encodeURIComponent(teamId)}/sprints`);

export const createSprint = (teamId: string, name: string, start: string | null = null, end: string | null = null) =>
  call<{ id: string }>(`/api/teams/${encodeURIComponent(teamId)}/sprints`, {
    method: "POST", body: JSON.stringify({ name, start, end }),
  });

export const updateSprint = (id: string, patch: { name?: string; start?: string | null; end?: string | null; state?: SprintState }) =>
  call<Record<string, never>>(`/api/sprints/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify(patch),
  });
