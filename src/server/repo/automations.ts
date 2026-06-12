/* Repository: automation rules + run audit. Actions are stored as a JSON
   array already validated by the route's zod schema; a row that fails to
   parse at read time is surfaced disabled rather than crashing reads. */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import type { WriteResult } from "./structure";

export type AutomationAction =
  | { kind: "wiMove"; to: string }
  | { kind: "wiComment"; text: string }
  | { kind: "itemComment"; text: string }
  | { kind: "wiUpdate"; patch: Record<string, unknown> };

export interface AutomationRule {
  id: string;
  name: string;
  triggerKind: string;
  cql: string | null;
  actions: AutomationAction[];
  enabled: boolean;
}

function toRule(r: RowDataPacket): AutomationRule {
  let actions: AutomationAction[] = [];
  let parseFailed = false;
  try {
    const parsed: unknown = JSON.parse(r.actions);
    if (Array.isArray(parsed)) actions = parsed as AutomationAction[];
    else parseFailed = true;
  } catch { parseFailed = true; }
  return {
    id: r.id, name: r.name, triggerKind: r.trigger_kind,
    cql: r.cql ?? null, actions,
    enabled: !!r.enabled && !parseFailed,
  };
}

export async function listRules(): Promise<AutomationRule[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, name, trigger_kind, cql, actions, enabled FROM automation_rules ORDER BY created_at, id");
  return rows.map(toRule);
}

export async function enabledRulesFor(triggerKind: string): Promise<AutomationRule[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, name, trigger_kind, cql, actions, enabled FROM automation_rules WHERE enabled = 1 AND trigger_kind = ?",
    [triggerKind]);
  return rows.map(toRule).filter((r) => r.enabled); // drops JSON-corrupted rows
}

export async function createRule(
  name: string, triggerKind: string, cql: string | null, actions: AutomationAction[],
): Promise<WriteResult> {
  const id = "auto-" + randomUUID();
  try {
    await pool().query(
      "INSERT INTO automation_rules (id, name, trigger_kind, cql, actions) VALUES (?, ?, ?, ?, ?)",
      [id, name, triggerKind, cql, JSON.stringify(actions)]);
    return { ok: true, id };
  } catch (e) {
    if (!!e && typeof e === "object" && (e as { code?: string }).code === "ER_DUP_ENTRY")
      return { ok: false, error: `A rule named "${name}" already exists.` };
    throw e;
  }
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>(
    "UPDATE automation_rules SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
  if (r.affectedRows === 0) return { ok: false, error: "Rule not found." };
  return { ok: true, id };
}

export async function deleteRule(id: string): Promise<WriteResult> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM automation_rules WHERE id = ?", [id]);
  if (r.affectedRows === 0) return { ok: false, error: "Rule not found." };
  return { ok: true, id };
}

export async function recordRun(ruleId: string, eventId: string, ok: boolean, detail: string | null): Promise<void> {
  await pool().query(
    "INSERT INTO automation_runs (rule_id, event_id, ok, detail) VALUES (?, ?, ?, ?)",
    [ruleId, eventId, ok ? 1 : 0, detail?.slice(0, 500) ?? null]);
}

export interface AutomationRun {
  ruleId: string;
  eventId: string;
  ok: boolean;
  detail: string | null;
  at: string;
}

export async function listRuns(limit = 50): Promise<AutomationRun[]> {
  const capped = Math.max(1, Math.min(200, limit));
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT rule_id, event_id, ok, detail, at FROM automation_runs ORDER BY id DESC LIMIT ?", [capped]);
  return rows.map((r) => ({
    ruleId: r.rule_id, eventId: r.event_id, ok: !!r.ok,
    detail: r.detail ?? null, at: new Date(r.at).toISOString(),
  }));
}
