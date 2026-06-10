/* Client-side API helpers — thin typed wrapper over fetch + the response envelope.
   A 401 anywhere redirects to /login (session expired or not signed in). */
import type { Item, PdlcEvent, Role } from "./engine";

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

export const fetchMe = () => call<{ user: ApiUser }>("/api/auth/me");
export const fetchItems = () => call<{ items: Item[]; versions: Record<string, number> }>("/api/items");
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
