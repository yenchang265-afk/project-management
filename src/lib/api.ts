/* Client-side API helpers — thin typed wrapper over fetch + the response envelope.
   A 401 anywhere redirects to /login (session expired or not signed in). */
import type { Item, PdlcEvent, Role, TransitionDef } from "./engine";
import type { SearchHit } from "./search";
import type { SprintState } from "./sprints";

export interface ApiUser { id: string; email: string; name: string; role: Role; }

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; data?: unknown };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    // FormData bodies must NOT get a JSON content-type — the browser sets the
    // multipart boundary itself.
    const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
    res = await fetch(path, {
      ...init,
      headers: isForm ? init?.headers : { "Content-Type": "application/json", ...(init?.headers || {}) },
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
  workflowSchemeId: string | null;
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

/** Server-side "search everything" over the caller's scoped items. */
export const searchAll = (q: string) =>
  call<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
export const fetchItems = () => call<{ items: Item[]; versions: Record<string, number> }>("/api/items");
export const fetchStructure = () => call<Structure>("/api/structure");

/* ---------- workflow schemes (G-13) ---------- */
export interface WorkflowSchemeInfo { id: string; name: string; transitions: TransitionDef[]; }
export const fetchWorkflowSchemes = () =>
  call<{ schemes: WorkflowSchemeInfo[] }>("/api/workflow-schemes");
export const createWorkflowScheme = (name: string, transitions: TransitionDef[]) =>
  call<{ id: string }>("/api/workflow-schemes", { method: "POST", body: JSON.stringify({ name, transitions }) });
export const updateWorkflowScheme = (id: string, name: string, transitions: TransitionDef[]) =>
  call<{ id: string }>(`/api/workflow-schemes/${id}`, { method: "PATCH", body: JSON.stringify({ name, transitions }) });
export const deleteWorkflowScheme = (id: string) =>
  call<Record<string, never>>(`/api/workflow-schemes/${id}`, { method: "DELETE" });
export const assignWorkflowScheme = (projectId: string, schemeId: string | null) =>
  call<Record<string, never>>(`/api/projects/${projectId}/workflow-scheme`, { method: "PUT", body: JSON.stringify({ schemeId }) });
export const logout = () => call<Record<string, never>>("/api/auth/logout", { method: "POST" });

export function postCommand(itemId: string, command: unknown, expectedVersion: number) {
  return call<{ event: PdlcEvent; version: number }>(`/api/items/${encodeURIComponent(itemId)}/commands`, {
    method: "POST",
    body: JSON.stringify({ command, expectedVersion }),
  });
}

/* ---------- bulk commands (1..50 ops; partial success — caller refetches) ---------- */
export interface BulkOp { itemId: string; expectedVersion: number; command: unknown; }
export interface BulkOpResult {
  itemId: string; status: "ok" | "stale" | "rejected" | "not_found";
  version?: number; event?: PdlcEvent; error?: string;
}

export const bulkCommands = (ops: BulkOp[]) =>
  call<{ results: BulkOpResult[] }>("/api/items/bulk", {
    method: "POST", body: JSON.stringify({ ops }),
  });

export function postSpawn(spawnFrom: string, expectedVersion: number) {
  return call<{ child: Item; parentEvent: PdlcEvent; parentVersion: number }>("/api/items", {
    method: "POST",
    body: JSON.stringify({ spawnFrom, expectedVersion }),
  });
}

/* ---------- Phase 3 admin (PM-only server-side) ---------- */
export const fetchUsers = () => call<{ users: TeamMemberInfo[] }>("/api/users");

export const createProject = (key: string, name: string, description: string | null, templateId?: string) =>
  call<{ id: string }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ key, name, description, ...(templateId ? { templateId } : {}) }),
  });

export const fetchProjectTemplates = () =>
  call<{ templates: { id: string; name: string }[] }>("/api/projects");

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

export const fetchAllSprints = () =>
  call<{ sprints: SprintInfo[] }>("/api/sprints");

/* ---------- Label + component registries (feed pickers; WIs store plain strings) ---------- */
export interface LabelInfo { id: string; name: string; }
export interface ComponentInfo { id: string; projectId: string; name: string; }

export const fetchLabels = () => call<{ labels: LabelInfo[] }>("/api/labels");
export const createLabel = (name: string) =>
  call<{ id: string }>("/api/labels", { method: "POST", body: JSON.stringify({ name }) });
export const deleteLabel = (id: string) =>
  call<Record<string, never>>(`/api/labels/${encodeURIComponent(id)}`, { method: "DELETE" });

export const fetchComponents = (projectId: string) =>
  call<{ components: ComponentInfo[] }>(`/api/components?projectId=${encodeURIComponent(projectId)}`);
export const createComponent = (projectId: string, name: string) =>
  call<{ id: string }>("/api/components", { method: "POST", body: JSON.stringify({ projectId, name }) });
export const deleteComponent = (id: string) =>
  call<Record<string, never>>(`/api/components/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------- Versions / releases (membership = items.fix_version column) ---------- */
export type VersionState = "unreleased" | "released" | "archived";
export interface VersionInfo {
  id: string; projectId: string; name: string;
  releaseDate: string | null; state: VersionState; itemCount: number;
}

export const fetchVersions = (projectId: string) =>
  call<{ versions: VersionInfo[] }>(`/api/versions?projectId=${encodeURIComponent(projectId)}`);

export const createVersion = (projectId: string, name: string, releaseDate: string | null = null) =>
  call<{ id: string }>("/api/versions", {
    method: "POST", body: JSON.stringify({ projectId, name, releaseDate }),
  });

export const updateVersion = (id: string, patch: { name?: string; releaseDate?: string | null; state?: VersionState }) =>
  call<Record<string, never>>(`/api/versions/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify(patch),
  });

export const deleteVersion = (id: string) =>
  call<Record<string, never>>(`/api/versions/${encodeURIComponent(id)}`, { method: "DELETE" });

export const setItemArchived = (itemId: string, archived: boolean) =>
  call<Record<string, never>>(`/api/items/${encodeURIComponent(itemId)}/archive`, {
    method: "PATCH", body: JSON.stringify({ archived }),
  });

export const assignItemVersion = (itemId: string, versionId: string | null) =>
  call<Record<string, never>>(`/api/items/${encodeURIComponent(itemId)}/version`, {
    method: "PATCH", body: JSON.stringify({ versionId }),
  });

/* ---------- Attachments (metadata; bytes served via /api/attachments/:id) ---------- */
export interface AttachmentInfo {
  id: string; itemId: string; wiId: string | null;
  filename: string; mime: string; size: number; uploader: string;
}

export const fetchAttachments = (itemId: string, wiId?: string) =>
  call<{ attachments: AttachmentInfo[] }>(
    `/api/items/${encodeURIComponent(itemId)}/attachments${wiId ? `?wiId=${encodeURIComponent(wiId)}` : ""}`);

export const uploadAttachment = (itemId: string, file: File, wiId?: string) => {
  const form = new FormData();
  form.append("file", file);
  if (wiId) form.append("wiId", wiId);
  return call<{ id: string }>(`/api/items/${encodeURIComponent(itemId)}/attachments`, {
    method: "POST", body: form, // call() skips the JSON content-type for FormData
  });
};

export const deleteAttachment = (id: string) =>
  call<Record<string, never>>(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------- Notification prefs (email opt-in; channel needs SMTP_URL) ---------- */
export const fetchNotificationPrefs = () =>
  call<{ emailEnabled: boolean; channelActive: boolean }>("/api/me/notification-prefs");
export const putNotificationPrefs = (emailEnabled: boolean) =>
  call<Record<string, never>>("/api/me/notification-prefs", { method: "PUT", body: JSON.stringify({ emailEnabled }) });

/* ---------- Dashboard gadget prefs (ordered kinds; null = default layout) ---------- */
export const fetchDashboardPrefs = () =>
  call<{ gadgets: string[] | null }>("/api/dashboard");
export const saveDashboardPrefs = (gadgets: string[]) =>
  call<Record<string, never>>("/api/dashboard", { method: "PUT", body: JSON.stringify({ gadgets }) });

/* ---------- Goals (membership stored; progress derived client-side) ---------- */
export type GoalStatus = "active" | "done" | "cancelled";
export interface GoalInfo {
  id: string; title: string; targetDate: string | null; status: GoalStatus; itemIds: string[];
}

export const fetchGoals = () => call<{ goals: GoalInfo[] }>("/api/goals");
export const createGoal = (title: string, targetDate: string | null) =>
  call<{ id: string }>("/api/goals", { method: "POST", body: JSON.stringify({ title, targetDate }) });
export const patchGoal = (id: string, patch: { status: GoalStatus } | { op: "add" | "remove"; itemId: string }) =>
  call<Record<string, never>>(`/api/goals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteGoal = (id: string) =>
  call<Record<string, never>>(`/api/goals/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------- Global audit log (PM only; seq-keyed pagination, newest first) ---------- */
export interface AuditEventInfo {
  seq: number; itemId: string; type: string; actor: string; role: string; ts: number;
}

export const fetchAudit = (opts: { actor?: string; type?: string; item?: string; beforeSeq?: number; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.actor) p.set("actor", opts.actor);
  if (opts.type) p.set("type", opts.type);
  if (opts.item) p.set("item", opts.item);
  if (opts.beforeSeq != null) p.set("beforeSeq", String(opts.beforeSeq));
  if (opts.limit != null) p.set("limit", String(opts.limit));
  const qs = p.toString();
  return call<{ events: AuditEventInfo[] }>(`/api/audit${qs ? `?${qs}` : ""}`);
};

/* ---------- Custom-field definitions (values travel in WI events) ---------- */
export type FieldKind = "text" | "number" | "date" | "select";
export interface FieldDefInfo {
  id: string; scope: string; key: string; name: string; kind: FieldKind; options: string[] | null;
}

export const fetchFieldDefs = (projectId: string | null) =>
  call<{ fields: FieldDefInfo[] }>(`/api/fields${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);

export const createFieldDef = (def: { projectId: string | null; key: string; name: string; kind: FieldKind; options?: string[] }) =>
  call<{ id: string }>("/api/fields", { method: "POST", body: JSON.stringify(def) });

export const deleteFieldDef = (id: string) =>
  call<Record<string, never>>(`/api/fields/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------- Saved filters (named CQL queries; shared = visible to everyone) ---------- */
export interface SavedFilterInfo {
  id: string; name: string; cql: string; shared: boolean; mine: boolean;
}

export const fetchFilters = () =>
  call<{ filters: SavedFilterInfo[] }>("/api/filters");

export const createFilter = (name: string, cql: string, shared: boolean) =>
  call<{ id: string }>("/api/filters", {
    method: "POST", body: JSON.stringify({ name, cql, shared }),
  });

export const deleteFilter = (id: string) =>
  call<Record<string, never>>(`/api/filters/${encodeURIComponent(id)}`, { method: "DELETE" });

export const createSprint = (teamId: string, name: string, start: string | null = null, end: string | null = null) =>
  call<{ id: string }>(`/api/teams/${encodeURIComponent(teamId)}/sprints`, {
    method: "POST", body: JSON.stringify({ name, start, end }),
  });

export const updateSprint = (id: string, patch: { name?: string; start?: string | null; end?: string | null; state?: SprintState }) =>
  call<Record<string, never>>(`/api/sprints/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify(patch),
  });
