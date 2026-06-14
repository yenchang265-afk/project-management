# Work Item Cloning (Jira "Clone issue") — Spec & Plan

Date: 2026-06-14
Gap: Jira-standard "Clone issue" — absent in Cadence (fresh gap analysis, not in original G-1..G-28 list).

## Goal
Let a user clone an existing work item: create a new WI that copies all *cloneable* fields from a source WI, so similar work can be created in one click instead of re-typing every field.

## Design (respects existing architecture)
- **One command → one event.** Clone is a single `WI_CREATE` event whose `wi` payload carries all cloneable fields copied from the source. The `deriveItem` fold already applies any `WorkItem` field present in a `WI_CREATE` payload (proven by existing test: description/priority/storyPoints/severity survive a `WI_CREATE`).
- **Pure engine function** `cloneWorkItem(...)` mirrors `createWorkItem` (ID gen via `nextWorkItemId`, returns `WiResult` = `{ok,event}|{ok:false,error}`, never throws).
- Metadata, not lifecycle: clone is still an event on the parent item's log (work items are event-sourced), so concurrency/append rules hold unchanged.

### Cloneable fields (copied from source)
`type`, `assignee`, `description`, `acceptanceCriteria`, `priority`, `storyPoints`, `severity`, `tags`, `phase`, `sprint`, `dueDate`, `component`, `parentWiId`, `originalEstimate`, `customFields`.

### Field rules
- `title`: `"Clone of " + source.title`, capped at 500 chars (truncate if needed). Caller may override with an explicit `titleOverride`.
- `state`: reset to `"todo"` (a clone is fresh work, not in-progress).
- `remainingEstimate`: reset to `source.originalEstimate` (no work logged yet).
- **Not copied (derived / per-instance):** `id` (fresh via `nextWorkItemId`), `comments`, `worklogs`, `timeSpent`, `links`.
- Source not found → `{ok:false, error:"Work item <id> not found."}`.

### Out of scope (v1, documented follow-ups)
- Auto "clones / is cloned by" link back to source (needs a 2nd event; the command→single-event invariant keeps v1 to one event). Add a `"clones"` link type + a follow-up command later.
- Deep clone of subtasks.

## Implementation steps (TDD — RED first each step)

1. **Engine (`src/lib/engine.ts`)** — add `cloneWorkItem(item, snap, fromWiId, actor, role, opts?: {titleOverride?: string}): WiResult`.
   - Tests first in `src/lib/workitems.test.ts`:
     - clones all cloneable fields into the new snapshot WI
     - new id is fresh (`nextWorkItemId`), differs from source
     - title is `"Clone of <title>"`; `titleOverride` wins
     - `state` reset to `todo` even if source is `in_progress`/`done`
     - comments/worklogs/links NOT copied; `timeSpent` 0
     - `remainingEstimate` reset to source `originalEstimate`
     - source-not-found → `{ok:false}`
     - customFields copied
2. **Command (`src/server/commands.ts`)** — add variant `{kind:"wiClone", fromWiId: string(max32), titleOverride?: string(max500)}` (`.strict()`), dispatch `case "wiClone"` → `cloneWorkItem`.
   - Test: add a valid `wiClone` sample to the command-schema test in `src/server/commands.test.ts`; assert dispatch returns a `WI_CREATE` event.
3. **UI dispatch (`src/components/App.tsx`)** — `cloneWorkItem(itemId, fromWiId)` → `sendCmd(itemId, {kind:"wiClone", fromWiId}, {ok:true, message:"Cloned work item"})`. Thread the callback to the drawer.
4. **UI button (`src/components/WorkItemDrawer.tsx`)** — a "Clone" action that calls the callback with the open WI's id; on success the new WI appears in the list.

## Verification gates
- `npx tsc` clean.
- `npm test` green (new engine + command tests pass; no regressions).
- Fresh verification subagent: independent correctness review + full test/tsc/build run.
