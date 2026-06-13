/* Repository: workflow schemes (G-13). A scheme is a validated TransitionDef[]
   stored as JSON; a project points at one via projects.workflow_scheme_id.
   getProjectTransitions resolves the effective table for the write path —
   returning undefined when the project has no scheme so the engine falls back
   to its built-in TRANSITIONS (behaviour unchanged until a project opts in).

   Same WriteResult pattern as repo/structure.ts; every write runs the scheme
   through validateWorkflow first, so a malformed table can never be stored. */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { type TransitionDef } from "@/lib/engine";
import { validateWorkflow } from "@/lib/workflow";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export interface WorkflowSchemeInfo {
  id: string;
  name: string;
  transitions: TransitionDef[];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

function parseTransitions(raw: unknown): TransitionDef[] {
  // mysql2 returns JSON columns already parsed; tolerate a string just in case.
  if (typeof raw === "string") return JSON.parse(raw) as TransitionDef[];
  return (raw as TransitionDef[]) ?? [];
}

export async function listSchemes(): Promise<WorkflowSchemeInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, name, transitions FROM workflow_schemes ORDER BY name");
  return rows.map((r) => ({ id: r.id, name: r.name, transitions: parseTransitions(r.transitions) }));
}

export async function getScheme(id: string): Promise<WorkflowSchemeInfo | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, name, transitions FROM workflow_schemes WHERE id = ?", [id]);
  if (!rows[0]) return null;
  return { id: rows[0].id, name: rows[0].name, transitions: parseTransitions(rows[0].transitions) };
}

export async function createScheme(name: string, transitions: TransitionDef[]): Promise<WriteResult> {
  const v = validateWorkflow(transitions);
  if (!v.ok) return { ok: false, error: v.errors.join(" ") };
  const id = "wfs-" + slug(name);
  try {
    await pool().query(
      "INSERT INTO workflow_schemes (id, name, transitions) VALUES (?, ?, ?)",
      [id, name, JSON.stringify(transitions)]);
    return { ok: true, id };
  } catch (e) {
    if (!!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY")
      return { ok: false, error: `A workflow scheme named "${name}" already exists.` };
    throw e;
  }
}

export async function updateScheme(id: string, name: string, transitions: TransitionDef[]): Promise<WriteResult> {
  const v = validateWorkflow(transitions);
  if (!v.ok) return { ok: false, error: v.errors.join(" ") };
  const [r] = await pool().query<ResultSetHeader>(
    "UPDATE workflow_schemes SET name = ?, transitions = ? WHERE id = ?",
    [name, JSON.stringify(transitions), id]);
  if (r.affectedRows === 0) return { ok: false, error: "Workflow scheme not found." };
  return { ok: true, id };
}

export async function deleteScheme(id: string): Promise<WriteResult> {
  // projects.workflow_scheme_id FK is ON DELETE SET NULL → affected projects
  // revert to the engine default automatically.
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM workflow_schemes WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Workflow scheme not found." };
  return { ok: true, id };
}

export async function assignScheme(projectId: string, schemeId: string | null): Promise<WriteResult> {
  if (schemeId) {
    const s = await getScheme(schemeId);
    if (!s) return { ok: false, error: "Workflow scheme not found." };
  }
  const [r] = await pool().query<ResultSetHeader>(
    "UPDATE projects SET workflow_scheme_id = ? WHERE id = ?", [schemeId, projectId]);
  if (r.affectedRows === 0) return { ok: false, error: "Project not found." };
  return { ok: true, id: projectId };
}

/**
 * Resolve the effective transition table for a project on the write path.
 * Returns undefined when the project has no scheme (or none given) so the
 * engine uses its built-in TRANSITIONS. Accepts a connection so it can run
 * inside the same locked transaction as the command append.
 */
export async function getProjectTransitions(
  projectId: string | null | undefined,
  conn?: PoolConnection
): Promise<TransitionDef[] | undefined> {
  if (!projectId) return undefined;
  const q = conn ?? pool();
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT s.transitions AS transitions
       FROM projects p
       JOIN workflow_schemes s ON s.id = p.workflow_scheme_id
      WHERE p.id = ?`, [projectId]);
  if (!rows[0]) return undefined;
  return parseTransitions(rows[0].transitions);
}
