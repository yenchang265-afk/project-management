/* Repository: custom-field definitions. Values stay in WI_UPDATE events
   (customFields per-key deltas) — these rows only describe which keys exist
   and how the drawer should render them. Same WriteResult pattern as
   repo/structure.ts. scope '' = global. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export type FieldKind = "text" | "number" | "date" | "select";

export interface FieldDefInfo {
  id: string;
  scope: string; // '' = global, else project id
  key: string;
  name: string;
  kind: FieldKind;
  options: string[] | null; // select choices
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

function toInfo(r: RowDataPacket): FieldDefInfo {
  let options: string[] | null = null;
  if (r.options != null) {
    try {
      const parsed: unknown = JSON.parse(r.options);
      if (Array.isArray(parsed)) options = parsed.map(String);
    } catch { options = null; } // tolerate a corrupted row instead of failing every read
  }
  return { id: r.id, scope: r.scope, key: r.key, name: r.name, kind: r.kind as FieldKind, options };
}

/** Global defs + the project's own (project rows override nothing — keys are
 *  disjoint per scope; the UI lists both groups). */
export async function listFieldDefs(projectId: string | null): Promise<FieldDefInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, scope, `key`, name, kind, options FROM field_defs WHERE scope = '' OR scope = ? ORDER BY scope, `key`",
    [projectId ?? ""]);
  return rows.map(toInfo);
}

export async function createFieldDef(
  projectId: string | null, key: string, name: string, kind: FieldKind, options: string[] | null,
): Promise<WriteResult> {
  if (!KEY_RE.test(key))
    return { ok: false, error: "Field keys are 1–64 chars: lowercase letters, digits, _ or - (starting alphanumeric)." };
  if (kind === "select" && (!options || options.length === 0))
    return { ok: false, error: "A select field needs at least one option." };
  const scope = projectId ?? "";
  if (scope) {
    const [p] = await pool().query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ?", [scope]);
    if (!p[0]) return { ok: false, error: "Project not found." };
  }
  const id = scope ? `fld-${slug(key)}-${slug(scope.replace(/^prj-/, ""))}` : `fld-${slug(key)}`;
  try {
    await pool().query(
      "INSERT INTO field_defs (id, scope, `key`, name, kind, options) VALUES (?, ?, ?, ?, ?, ?)",
      [id, scope, key, name, kind, kind === "select" ? JSON.stringify(options) : null]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A field with key "${key}" already exists in this scope.` };
    throw e;
  }
}

export async function deleteFieldDef(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM field_defs WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Field definition not found." };
  return { ok: true, id };
}
