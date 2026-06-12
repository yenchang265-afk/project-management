/* Repository: label + component registries. Same WriteResult pattern as
   repo/structure.ts — duplicates and missing rows come back as
   {ok:false,error} for 422 mapping. Work-item events keep storing plain
   strings; these tables only feed pickers and autocomplete. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export interface LabelInfo { id: string; name: string; }
export interface ComponentInfo { id: string; projectId: string; name: string; }

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

/* ---------- labels (global) ---------- */

export async function listLabels(): Promise<LabelInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>("SELECT id, name FROM labels ORDER BY name");
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function createLabel(name: string): Promise<WriteResult> {
  const id = "lbl-" + slug(name);
  try {
    await pool().query("INSERT INTO labels (id, name) VALUES (?, ?)", [id, name]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A label named "${name}" already exists.` };
    throw e;
  }
}

export async function deleteLabel(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM labels WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Label not found." };
  return { ok: true, id };
}

/* ---------- components (per project) ---------- */

export async function listComponents(projectId: string): Promise<ComponentInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, project_id, name FROM components WHERE project_id = ? ORDER BY name", [projectId]);
  return rows.map((r) => ({ id: r.id, projectId: r.project_id, name: r.name }));
}

export async function createComponent(projectId: string, name: string): Promise<WriteResult> {
  const [p] = await pool().query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ?", [projectId]);
  if (!p[0]) return { ok: false, error: "Project not found." };
  const id = `cmp-${slug(name)}-${slug(projectId.replace(/^prj-/, ""))}`;
  try {
    await pool().query(
      "INSERT INTO components (id, project_id, name) VALUES (?, ?, ?)", [id, projectId, name]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A component named "${name}" already exists in this project.` };
    throw e;
  }
}

export async function deleteComponent(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM components WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Component not found." };
  return { ok: true, id };
}
