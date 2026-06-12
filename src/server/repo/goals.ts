/* Repository: goals + item membership. Progress is derived in the route from
   member items' event logs — only membership rows live here. Same WriteResult
   pattern as repo/structure.ts. */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export type GoalStatus = "active" | "done" | "cancelled";

export interface GoalInfo {
  id: string;
  title: string;
  targetDate: string | null; // YYYY-MM-DD
  status: GoalStatus;
  itemIds: string[];
}

function isDup(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

function dateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

export async function listGoals(): Promise<GoalInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, title, target_date, status FROM goals ORDER BY target_date IS NULL, target_date, title");
  const [members] = await pool().query<RowDataPacket[]>("SELECT goal_id, item_id FROM item_goals");
  const byGoal = new Map<string, string[]>();
  for (const m of members) {
    if (!byGoal.has(m.goal_id)) byGoal.set(m.goal_id, []);
    byGoal.get(m.goal_id)!.push(m.item_id);
  }
  return rows.map((r) => ({
    id: r.id, title: r.title, targetDate: dateStr(r.target_date),
    status: r.status as GoalStatus, itemIds: (byGoal.get(r.id) || []).sort(),
  }));
}

export async function createGoal(title: string, targetDate: string | null): Promise<WriteResult> {
  const id = "goal-" + slug(title);
  try {
    await pool().query("INSERT INTO goals (id, title, target_date) VALUES (?, ?, ?)", [id, title, targetDate]);
    return { ok: true, id };
  } catch (e) {
    if (isDup(e)) return { ok: false, error: `A goal titled "${title}" already exists.` };
    throw e;
  }
}

export async function setGoalStatus(id: string, status: GoalStatus): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("UPDATE goals SET status = ? WHERE id = ?", [status, id]);
  if (r.affectedRows === 0) return { ok: false, error: "Goal not found." };
  return { ok: true, id };
}

export async function deleteGoal(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM goals WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Goal not found." };
  return { ok: true, id };
}

export async function goalItemOp(goalId: string, itemId: string, op: "add" | "remove"): Promise<WriteResult> {
  if (op === "remove") {
    const [r] = await pool().query<ResultSetHeader>(
      "DELETE FROM item_goals WHERE goal_id = ? AND item_id = ?", [goalId, itemId]);
    if (r.affectedRows === 0) return { ok: false, error: "Item is not on this goal." };
    return { ok: true, id: goalId };
  }
  const [g] = await pool().query<RowDataPacket[]>("SELECT id FROM goals WHERE id = ?", [goalId]);
  if (!g[0]) return { ok: false, error: "Goal not found." };
  const [i] = await pool().query<RowDataPacket[]>("SELECT id FROM items WHERE id = ?", [itemId]);
  if (!i[0]) return { ok: false, error: "Item not found." };
  try {
    await pool().query("INSERT INTO item_goals (goal_id, item_id) VALUES (?, ?)", [goalId, itemId]);
  } catch (e) {
    if (!isDup(e)) throw e; // already linked — idempotent
  }
  return { ok: true, id: goalId };
}
