/* =========================================================================
   SEARCH — pure, engine-derived. No I/O, no DOM.
   matchItems folds each item through deriveItem (so tombstoned work items and
   their comment threads are already gone) and substring-matches the query,
   case-insensitively, over item id/title, derived WI ids/titles/tags, and
   item + WI comment texts.

   Query grammar: whitespace-separated tokens. `assignee:X`, `state:X`,
   `type:X`, `sprint:X` are filters (AND-combined, values matched as
   case-insensitive substrings); everything else re-joins as free text.
   - assignee/sprint exist only on work items, so those filters exclude
     item-level hits entirely.
   - state/type check the WI for WI hits and the item (derived spine state /
     item type) for item hits.
   - Filters with NO free text return every entity passing the filters.

   Ranking (best per entity, one hit per entity, capped at 50):
   id exact > id substring > title > wi_title > wi_tag > comment.
   ========================================================================= */
import { deriveItem, type Item, type WorkItem } from "./engine";

export interface SearchHit {
  itemId: string;
  title: string;        // owning item's title (always present)
  wiId?: string;        // set when the hit is a work item (or a WI comment)
  wiTitle?: string;
  field: "title" | "id" | "wi_title" | "wi_tag" | "comment";
}

export const SEARCH_CAP = 50;

const FILTER_KEYS = ["assignee", "state", "type", "sprint"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

/** Split q into filter tokens + remaining free text (all lowercased). */
function parseQuery(q: string): { filters: Filters; free: string } {
  const filters: Filters = {};
  const free: string[] = [];
  for (const tok of q.trim().split(/\s+/)) {
    if (!tok) continue;
    const m = /^(assignee|state|type|sprint):(.+)$/i.exec(tok);
    if (m) filters[m[1].toLowerCase() as FilterKey] = m[2].toLowerCase();
    else free.push(tok);
  }
  return { filters, free: free.join(" ").toLowerCase() };
}

const has = (hay: string | undefined, needle: string) =>
  (hay ?? "").toLowerCase().includes(needle);

/* rank values — lower sorts first */
const R_ID_EXACT = 0, R_ID = 1, R_TITLE = 2, R_WI_TITLE = 3, R_WI_TAG = 4, R_COMMENT = 5;

export function matchItems(rows: { item: Item }[], q: string): SearchHit[] {
  const { filters, free } = parseQuery(q);
  if (!free && Object.keys(filters).length === 0) return [];

  const ranked: { rank: number; hit: SearchHit }[] = [];
  const push = (rank: number, hit: SearchHit) => ranked.push({ rank, hit });

  for (const { item } of rows) {
    const snap = deriveItem(item);

    /* ----- item-level entity: id / title / item comments ----- */
    const itemPasses =
      filters.assignee === undefined && filters.sprint === undefined &&
      (filters.state === undefined || has(snap.state, filters.state)) &&
      (filters.type === undefined || has(item.type, filters.type));
    if (itemPasses) {
      const base: SearchHit = { itemId: item.id, title: item.title, field: "title" };
      if (!free) push(R_TITLE, base);
      else if (item.id.toLowerCase() === free) push(R_ID_EXACT, { ...base, field: "id" });
      else if (has(item.id, free)) push(R_ID, { ...base, field: "id" });
      else if (has(item.title, free)) push(R_TITLE, base);
      else if (snap.comments.some((c) => has(c.text, free))) push(R_COMMENT, { ...base, field: "comment" });
    }

    /* ----- work-item entities (deriveItem already dropped tombstones) ----- */
    for (const w of snap.workItems) {
      if (!wiPasses(w, filters)) continue;
      const base: SearchHit = {
        itemId: item.id, title: item.title, wiId: w.id, wiTitle: w.title, field: "wi_title",
      };
      if (!free) push(R_WI_TITLE, base);
      else if (w.id.toLowerCase() === free) push(R_ID_EXACT, { ...base, field: "id" });
      else if (has(w.id, free)) push(R_ID, { ...base, field: "id" });
      else if (has(w.title, free)) push(R_WI_TITLE, base);
      else if ((w.tags ?? []).some((t) => has(t, free))) push(R_WI_TAG, { ...base, field: "wi_tag" });
      else if ((w.comments ?? []).some((c) => has(c.text, free))) push(R_COMMENT, { ...base, field: "comment" });
    }
  }

  return ranked
    .sort((a, b) => a.rank - b.rank) // Array.prototype.sort is stable → input order ties
    .slice(0, SEARCH_CAP)
    .map((r) => r.hit);
}

function wiPasses(w: WorkItem, f: Filters): boolean {
  return (
    (f.assignee === undefined || has(w.assignee, f.assignee)) &&
    (f.sprint === undefined || has(w.sprint, f.sprint)) &&
    (f.state === undefined || has(w.state, f.state)) &&
    (f.type === undefined || has(w.type, f.type))
  );
}
