# WorkItem CRUD — Design Spec

**Date:** 2026-06-09
**Branch:** feat/cadence-pdlc-prototype
**Status:** Approved decisions, pending spec review

## Goal

Add Create / Read / Update / Delete for **work items** (the typed children — story / task / bug / etc.
shown in the "Work items" card on each feature). Today they are seed-only and read-only.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Persistence model | **Event-sourced** — `WI_CREATE` / `WI_UPDATE` / `WI_DELETE` events folded in `deriveItem` |
| 2 | Update scope | **Full edit** — title, type, assignee, state |
| 3 | Role guard | **Both roles** — PM and Dev can create/edit/delete; no role gate |
| 4 | UI pattern | **Inline in the card** — add-row form + inline row editing, no modal |

## Current state

- `WorkItem` type already exists — `src/lib/engine.ts:84` — `{ id, type, title, state, assignee }`.
  - `type: WiType` = `epic | feature | story | task | bug`
  - `state: WiState` = `todo | in_progress | in_review | blocked | done`
- Stored as a static `Item.workItems[]`, seeded once in `src/lib/seed.ts`.
- `src/components/WorkItems.tsx` renders it **read-only**: type breakdown, %-done bar, row list.
- **It is the only mutable data not in the event log.** Every other mutation in the app is an
  `ev(...)` append folded by `deriveItem` into a `Snapshot`. Work items must join that model.
- Tooling: vitest installed, **no test files yet**, no jsdom/RTL. → unit-test the **pure engine**, not React.
  No ESLint; `npx tsc` typechecks (`noEmit`).

## Architecture

### Event model

Extend the existing event-sourcing rather than adding a parallel mutable store.

```ts
// engine.ts — EventType union gains three members
export type EventType =
  | "CREATE" | "TRANSITION" | "CONDITION_SATISFY" | "CONDITION_WAIVE"
  | "CONDITION_RESET" | "SHIFT_LEFT_SET" | "GATE_SIGNOFF" | "GATE_SIGNOFF_CLEAR"
  | "SUBTRACK" | "FLAG_SET" | "SPAWN_CHILD"
  | "WI_CREATE" | "WI_UPDATE" | "WI_DELETE";

// PdlcEvent gains two optional payload fields (typed, not `any`)
  wiId?: string;            // target work-item id (all three WI_* events)
  wi?: Partial<WorkItem>;   // CREATE: full fields; UPDATE: patch
```

Payload conventions:
- `WI_CREATE` — `wiId` = new id, `wi` = `{ type, title, assignee, state }` (state defaults `todo`).
- `WI_UPDATE` — `wiId` = target, `wi` = patch (only changed fields).
- `WI_DELETE` — `wiId` = target (tombstone; append-only, never mutate prior events).

### Derivation (`deriveItem`)

`Snapshot` gains `workItems: WorkItem[]`. The fold:

1. Seed baseline: `workItems = (item.workItems || []).map(w => ({ ...w }))`.
2. In the existing ts-sorted event loop, add cases:
   - `WI_CREATE`: if `wiId` not already present, push `{ id: wiId, ...defaults, ...e.wi }`.
   - `WI_UPDATE`: replace the matching item with `{ ...existing, ...e.wi }` (new object; ignore unknown id).
   - `WI_DELETE`: filter out `wiId` (tombstone).
3. Order is handled by the existing ts sort — create-before-update-before-delete just works.

`WorkItems.tsx` then reads `snap.workItems` instead of `item.workItems`. With no WI_* events the
output is byte-identical to today, so the seed renders unchanged (verified in P2).

### Pure validators (mirror `applyTransition`)

```ts
export type WiResult = { ok: true; event: PdlcEvent } | { ok: false; error: string };

export function nextWorkItemId(item: Item, snap: Snapshot): string;
export function createWorkItem(item: Item, snap: Snapshot,
  draft: { type: WiType; title: string; assignee: string; state?: WiState },
  actor: string, role: Role): WiResult;
export function updateWorkItem(item: Item, snap: Snapshot, wiId: string,
  patch: Partial<WorkItem>, actor: string, role: Role): WiResult;
export function deleteWorkItem(item: Item, snap: Snapshot, wiId: string,
  actor: string, role: Role): WiResult;
```

- **No role guard** (decision 3) — both roles allowed; `actor`/`role` are recorded on the event for History.
- `nextWorkItemId`: prefix = `item.id.split("-")[0]`; pick `max(existing numeric suffix) + 1`. Scan both
  `snap.workItems` **and** every prior `WI_CREATE` `wiId` so a tombstoned id is never reused. Deterministic
  (no `Math.random`) → stable tests, no hydration risk.
- Validation → `{ ok: false, error }`:
  - empty/whitespace title (create, and update when title in patch)
  - duplicate id (create — defensive; `nextWorkItemId` already avoids it)
  - unknown id (update / delete)

### UI (`WorkItems.tsx`, inline)

Props become `{ item, snap, role, onCreate, onUpdate, onDelete }`. Keep the type breakdown + progress bar
(now from `snap.workItems`). Per row, add:
- inline **state dropdown** (always editable) → `onUpdate(id, { state })`
- **edit** toggle → swaps row to inputs (title text, type select, assignee select) + save / cancel → `onUpdate`
- **delete** button → `onDelete(id)`

Add-row form at the bottom: type select, title input, assignee select (names from `item.stakeholders`
+ known people), default state `todo`, **Add** button → `onCreate(draft)`.

Edit-mode / draft values live in local component `useState` (ephemeral UI state, not domain state).

### App wiring (`App.tsx`)

Three handlers following the existing dispatch pattern (`satisfyCond`, `signoff`, …):

```ts
function addWorkItem(draft) { const r = createWorkItem(item, snap, draft, actor, role);
  r.ok ? (append(item.id, r.event), pushToast({ ok: true, ... })) : pushToast({ ok: false, message: r.error }); }
function editWorkItem(wiId, patch) { /* updateWorkItem → append / toast */ }
function removeWorkItem(wiId)     { /* deleteWorkItem → append / toast */ }
```

Pass to `<WorkItems item={item} snap={snap} role={role} onCreate={addWorkItem} onUpdate={editWorkItem} onDelete={removeWorkItem} />`.

### History (`History.tsx`)

Add explicit `describeEvent` cases (the `default` case already renders them generically):
- `WI_CREATE` → `Added work item <b>{wiId}</b> · {wi.type}`
- `WI_UPDATE` → `Updated <b>{wiId}</b>`
- `WI_DELETE` → `Removed work item <b>{wiId}</b>`

### CSS (`app/globals.css`)

Small additive `.wi-*` rules for the add-row form, inline edit inputs, and small row action buttons —
reusing existing design tokens (`--surface-*`, `--border`, `--accent`). No new design system.

## Files touched

| File | Change |
|------|--------|
| `src/lib/engine.ts` | `EventType` +3; `PdlcEvent` +`wiId`/`wi`; `Snapshot.workItems`; `deriveItem` fold; `WiResult`; `nextWorkItemId`/`createWorkItem`/`updateWorkItem`/`deleteWorkItem` |
| `src/lib/workitems.test.ts` | **NEW** — TDD fold + validators |
| `src/components/WorkItems.tsx` | read `snap.workItems`; add create form, inline edit, delete |
| `src/components/App.tsx` | `addWorkItem` / `editWorkItem` / `removeWorkItem`; wire props |
| `src/components/History.tsx` | explicit `WI_*` cases |
| `app/globals.css` | `.wi-*` form/edit/button styles |

## Execution plan (TDD)

- **P0 — RED.** `workitems.test.ts`: baseline preserved; create/update/delete fold; tombstone; ordering;
  validators reject empty title / unknown id; `nextWorkItemId` uniqueness.
- **P1 — GREEN.** Engine: types, fields, `Snapshot.workItems`, fold, validators, id-gen. `npm test` green.
- **P2 — Read swap.** `WorkItems` reads `snap.workItems`; seed renders identically.
- **P3 — Create.** Inline add-row form → `WI_CREATE`.
- **P4 — Update.** Inline state dropdown + edit mode (title/type/assignee) → `WI_UPDATE`.
- **P5 — Delete.** Row delete tombstone → `WI_DELETE`.
- **P6 — Verify.** `npx tsc` + `npm test` + `npm run build` + manual smoke (role switch, History shows WI
  events, progress bar updates) + code-review pass.

## Testing strategy

- **Unit (vitest, pure engine):** the fold + validators — the real logic. Target full coverage of the new
  engine functions.
- **No React tests:** jsdom/RTL not installed; component is thin glue. Covered by P2/P6 manual smoke.
- **Typecheck/build:** `npx tsc` and `npm run build` must stay clean.

## Non-goals (YAGNI)

- No persistence/MariaDB (still a prototype; whole app is in-memory).
- No drag-reorder, no sub-work-items, no bulk edit, no work-item-level gates or analytics beyond the
  existing %-done bar.
- No new role-permission model (decision 3: both roles).
- Work-item `state` stays its own enum, independent of the PDLC spine state.
