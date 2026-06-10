# WorkItem Detail Fields + Discussion — Design Spec

**Date:** 2026-06-09
**Branch:** feat/cadence-pdlc-prototype
**Status:** Approved, implementing

## Goal

Give work items the richer fields and a discussion thread you'd expect in Azure DevOps, edited in a
right-side **drawer** opened from a work-item row. Stays fully event-sourced.

## Decisions (locked)

- Fields: Description, Acceptance criteria, Priority, Story points, Severity, Tags, Discussion (all).
- UI: **right-side drawer** opened by clicking a row's title (pencil ✎ keeps quick inline rename).
- Comments: append-only (no edit/delete). Text fields auto-save on blur; selects/number/tags on change.

## Data model (`engine.ts`)

```ts
export type WiPriority = 1 | 2 | 3 | 4; // 1 = highest
export type WiSeverity = 1 | 2 | 3 | 4; // 1 = Critical .. 4 = Low

export interface WiComment { id: string; author: string; role: Role; ts: number; text: string; }

export interface WorkItem {
  id: string; type: WiType; title: string; state: WiState; assignee: string;
  // new — all optional, so seed items are unchanged
  description?: string;
  acceptanceCriteria?: string;
  priority?: WiPriority;
  storyPoints?: number;       // >= 0
  severity?: WiSeverity;
  tags?: string[];            // trimmed, de-duped, non-empty
  comments?: WiComment[];     // DERIVED from WI_COMMENT events (omitted when none)
}
```

Label maps for the UI: `WI_PRIORITIES`/`WI_PRIORITY_LABELS`, `WI_SEVERITIES`/`WI_SEVERITY_LABELS`.

## Event model

Stays event-sourced. No parallel mutable store.

- **Scalar + tags** fields ride the existing **`WI_UPDATE`** generic `Partial<WorkItem>` patch — `deriveItem`
  already folds `{ ...w, ...patch, id }`, so they patch through with no fold change.
- **`WI_COMMENT`** (new `EventType`) — payload `{ wiId, text }`; `PdlcEvent` gains `text?: string`.
  Author = actor, role = current role. Folded into each item's `comments[]`, ordered by ts.

### `deriveItem` changes
1. `WI_CREATE` fold: carry the optional scalar/tags fields from `e.wi` when present (required fields keep
   their defaults).
2. New `WI_COMMENT` case: accumulate `commentsByWi[wiId]` from the ts-sorted events.
3. After building `workItems`, attach `comments` **only to items that have any** (so comment-less baseline
   items keep their exact shape — preserves the existing baseline test).

## Validators (`engine.ts`)

`updateWorkItem` (extend existing diff/guard):
- Validate before diff: `priority`/`severity` ∈ {1,2,3,4}; `storyPoints` finite and ≥ 0; `tags` is an array.
- Diff & drop unchanged (existing behaviour) extended to the new fields. **Tags** are normalized
  (`normalizeTags`: trim, drop empty, de-dupe, preserve order) and compared by order-sensitive equality, so
  an unchanged tag edit is a no-op (no event), a real change emits one.
- `description`/`acceptanceCriteria` are stored verbatim (multiline); empty string clears the field.

`commentWorkItem(item, snap, wiId, text, author, role): WiResult` (new):
- Reject unknown `wiId`; reject blank/whitespace text; otherwise emit `WI_COMMENT` with trimmed text.

`createWorkItem` unchanged (new fields are set in the drawer after creation). `nextWorkItemId`,
`deleteWorkItem` unchanged.

## UI

### `WorkItemDrawer.tsx` (new)
Right-side panel overlay (scrim + slide-in), opened for one `wiId` in the current item.
- Header: type glyph · id · editable title · close ✕.
- Quick row: State, Assignee, Priority, Severity, Story points.
- Description textarea, Acceptance criteria textarea (commit on blur).
- Tags: chips with × remove + an add input (Enter / comma to add).
- Discussion: comment list (avatar · author · role · relative time · text) + comment box + Post.
- All edits call `onUpdate(wiId, patch)` / `onComment(wiId, text)`; the engine's no-op guard keeps the log clean.

### `WorkItems.tsx`
- The row title becomes a button that opens the drawer (`onOpen(w.id)`). Inline ✎ rename / ✕ delete and the
  state dropdown stay. A small open affordance (e.g. ↗) hints the drawer.

### `App.tsx`
- `openWiId: string | null` state; `commentWorkItem` handler appends `WI_COMMENT`.
- Render `<WorkItemDrawer>` when `openWiId` is set **and** that id is in `snap.workItems`; close on feature
  switch (derive open item from current snapshot, clear when absent).

### `History.tsx`
- `WI_COMMENT` → "Commented on PAY-419". `WI_UPDATE` already lists changed field keys (now incl. new fields).

### `globals.css`
- Additive `.wi-drawer*`, `.wi-field`, `.wi-tags`/`.wi-tag`, `.wi-comment*` using existing tokens + the
  existing `.scrim`/`rise` animation pattern.

## Files

`engine.ts`, `src/lib/workitems.test.ts`, **`src/components/WorkItemDrawer.tsx`** (new),
`src/components/WorkItems.tsx`, `src/components/App.tsx`, `src/components/History.tsx`, `app/globals.css`,
plus Playwright specs under `e2e/`.

## Execution plan (TDD)

- **P1 — engine (TDD):** types, `WI_COMMENT`, `text`, fold (create fields + comments), `updateWorkItem`
  validation + tag-aware diff, `commentWorkItem`, label maps. RED → GREEN.
- **P2 — drawer:** `WorkItemDrawer.tsx`.
- **P3 — wire:** row title → drawer; `App` `openWiId` + comment handler + render/close.
- **P4 — History:** `WI_COMMENT` case.
- **P5 — CSS:** drawer / tags / comments.
- **P6 — verify:** `npx tsc` + `npm test` + `npm run build` + Playwright e2e (open drawer, edit description→blur
  persists+logged, set priority/points, add/remove tag, post comment, close) + review pass.

## Testing

- **Unit (vitest, pure engine):** field validation (priority/severity range, storyPoints ≥0), `normalizeTags`,
  tag-aware no-op vs change, `commentWorkItem` (blank reject, unknown id), comment fold/order, `WI_CREATE`
  carries optional fields, baseline shape preserved.
- **E2E (Playwright):** the drawer flows above.
- **Typecheck/build:** stay clean.

## Non-goals (YAGNI)

- No comment edit/delete, no @mentions, no attachments/file upload, no rich-text/markdown rendering
  (plain multiline text), no work-item links/relations, no iteration/sprint or area-path fields, no
  per-field history beyond the existing event log, no persistence.
