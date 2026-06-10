# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server → http://localhost:3000
npm run build    # production build
npm start        # serve the production build
npm test         # run engine unit tests (vitest run)
npx tsc          # typecheck only (tsconfig has noEmit: true); there is no lint script / no ESLint
```

Run a single test by name (vitest `-t` matches `describe`/`it` text):

```bash
npm test -- -t "shift-left"          # one test or block by substring
npx vitest                            # watch mode while iterating
```

## Architecture

Cadence is a **pure client-side, in-memory** React app modelling a product-development lifecycle (PDLC) as an **event-sourced state machine**. There is no backend, database, or API route — read the layers in this order: `src/lib/engine.ts` → `src/lib/seed.ts` → `src/components/App.tsx`.

### The engine is the whole system (`src/lib/engine.ts`)
Pure data + pure functions, zero React/DOM. The append-only **event log is the single source of truth**; everything else is derived:

- `deriveItem(item)` folds an item's `events[]` into a live `Snapshot` (current `state`, `conditions`, `flags`, `signoffs`, `subtracks`, `children`, `activeRisks`). Called fresh on every render — never cache a snapshot as mutable state.
- `applyTransition(item, toState, actor, role, reason)` is the only mover. It **never throws**: returns `{ ok: true, event }` or `{ ok: false, rejection }` where `rejection.type` is one of `ILLEGAL_TRANSITION | ROLE_GUARD | GATE_CONDITIONS_UNSATISFIED | GATE_SIGNOFF_MISSING | REASON_REQUIRED`. The UI renders rejections as toasts.
- `ev(...)` constructs events. Analytics (`timeInState`, `reworkRate`, `leadTime`, `planVsActual`) are also pure folds over the log.

### Rules live in declarative tables, not in code branches
To change lifecycle behaviour, **edit the data tables, not the functions**:

- `STATES` — 12 on-spine states (`spine: 0..11`) across lanes discovery→build→verify→release→closed, plus 3 off-spine terminals (`rejected`, `deferred`, `rolled_back`).
- `TRANSITIONS` — the **only** place transition rules live: `{from, to, roles, kind, gate?, needsReason?}`. `legalTransitions(state)` and `applyTransition` both read it.
- Gates are modelled as a `gate` **property on a transition** (see `GATE_BEFORE`), not as bespoke states. A gate opens only when `blocking.length === 0` **and** dual PM **and** Dev sign-off are present (`gateStatus`).
- `GATES` — conditions per gate; `base: "required"` must be satisfied, `base: "not_applicable"` + `conditional: true` are off by default.
- `SHIFT_LEFT` — ticking a risk flips its mapped conditional conditions `not_applicable → required` (and reverts when unticked, unless already satisfied/waived). This is recomputed in a second pass inside `deriveItem`.
- `SUBTRACK_FLOW` — `security`/`compliance` mini state machines (`pending→in_review→changes_requested↔in_review→approved`). They run concurrently and never block the spine; an `approved` sub-track **auto-satisfies** its linked release-gate condition.
- `WI_FLOW_BASE` / `WI_FLOW_OVERRIDES` — per-type work-item workflows. `transitionWorkItem` is the flow-checked mover (also rejects a move to `done` while open `blocks` links point at the item — see `wiBlockedBy`); `updateWorkItem` stays a free-form admin edit, state included. The `work_complete` release condition is a **derived rollup**: auto-satisfied in `deriveItem` when every work item is `done` (vacuously true with none), reverting if one reopens — explicit satisfy/waive events always win.
- Work items also carry `phase` (discovery/build/verify/release — board swimlane + spine bridge), `sprint`, `links` (`WI_LINK`/`WI_UNLINK` events; dangling links to tombstoned targets are dropped at derive time) and manual rank (`WI_REORDER` stores the full ordered id list; later creations append).

### UI ↔ engine loop (`src/components/App.tsx`)
`App` holds `items: Item[]` in `useState` (seeded once from `buildSeed(Date.now())`) and the current `role` (`"PM" | "Dev"`). Every action follows the same pattern:

1. call an engine function (e.g. `applyTransition`) → get an event,
2. `append(itemId, event)` updates state **immutably**: `{ ...it, events: [...it.events, event] }` — never mutate the existing item or its events,
3. re-render derives a fresh snapshot via `deriveItem(item)`.

Condition toggles, sign-offs, shift-left ticks, sub-track moves, flag sets, and child spawns are all just `ev(...)` appends. Role-switching (`setRole`) flips which actions/sign-offs are permitted — guards are enforced in the engine, not the UI. Components consume engine tables/functions directly (e.g. `Spine`, `GateInspector`, `PlanVsActual`, `Navigator`, `Actions`). `app/page.tsx` renders `App` client-side to avoid an SSR hydration mismatch (the engine uses `Date.now()`/`Math.random()`).

### Conventions & gotchas
- **No persistence.** All state is in memory and lost on refresh; `src/lib/seed.ts` reseeds on mount. Persistence is not yet implemented — the planned datastore is **MariaDB**, so do not introduce Postgres-specific SQL when that work lands.
- **`app/globals.css` is verbatim from the design prototype** in `prototype-handoff/` (oklch design tokens). Treat it as the source of truth for styling — extend it, don't re-author the design system from scratch.
- Imports use the `@/*` → `./src/*` path alias (tsconfig).
- The item hierarchy (org→group→team→epic→feature) is reconstructed in `Navigator` from the flat `Item.parent` field; there is no nesting table.
