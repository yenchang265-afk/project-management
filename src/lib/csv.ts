/* =========================================================================
   CSV import — pure parse + map (no React/DOM/DB). Imported rows become
   wiCreate command DRAFTS: creation goes through the normal command path,
   so per-type flows and guards still apply server-side.
   ========================================================================= */

import { WI_STATES_ALL, WI_TYPES_ALL, isIsoDate, type WiState, type WiType } from "./engine";

/** RFC 4180-ish parser: quoted fields may contain commas, escaped quotes
 *  ("" → ") and newlines. Handles CRLF; drops a trailing empty line. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 2; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export interface WiImportDraft {
  itemId: string;
  draft: {
    type: WiType; title: string; assignee: string;
    state?: WiState; sprint?: string; dueDate?: string; component?: string;
  };
}

export interface WiImportResult {
  drafts: WiImportDraft[];
  errors: string[]; // human-readable, with 1-based CSV row numbers
}

const TYPE_SET = new Set<string>(WI_TYPES_ALL);
const STATE_SET = new Set<string>(WI_STATES_ALL);

/** Map parsed CSV (header + data rows) to wiCreate drafts. Column names match
 *  the list view's export: item, title, type, state, assignee, sprint,
 *  due_date, component — extra columns are ignored. */
export function mapCsvToWiDrafts(rows: string[][], validItemIds: Set<string>): WiImportResult {
  const drafts: WiImportDraft[] = [];
  const errors: string[] = [];
  if (!rows.length) return { drafts, errors: ["Empty CSV."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const required of ["item", "title", "type"])
    if (col(required) === -1) return { drafts, errors: [`Missing required column "${required}".`] };

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const cell = (name: string) => (col(name) === -1 ? "" : (cells[col(name)] ?? "").trim());
    const rowNo = r + 1; // 1-based incl. header

    const itemId = cell("item");
    const title = cell("title");
    const type = cell("type");
    const state = cell("state");
    const dueDate = cell("due_date");
    if (!itemId || !validItemIds.has(itemId)) { errors.push(`row ${rowNo}: unknown item "${itemId}".`); continue; }
    if (!title) { errors.push(`row ${rowNo}: title is required.`); continue; }
    if (!TYPE_SET.has(type)) { errors.push(`row ${rowNo}: invalid type "${type}".`); continue; }
    if (state && !STATE_SET.has(state)) { errors.push(`row ${rowNo}: invalid state "${state}".`); continue; }
    if (dueDate && !isIsoDate(dueDate)) { errors.push(`row ${rowNo}: due_date must be YYYY-MM-DD.`); continue; }

    const draft: WiImportDraft["draft"] = { type: type as WiType, title, assignee: cell("assignee") };
    if (state) draft.state = state as WiState;
    if (cell("sprint")) draft.sprint = cell("sprint");
    if (dueDate) draft.dueDate = dueDate;
    if (cell("component")) draft.component = cell("component");
    drafts.push({ itemId, draft });
  }
  return { drafts, errors };
}
