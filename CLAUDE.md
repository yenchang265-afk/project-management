# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server → http://localhost:3000 (needs MariaDB + .env.local)
npm run build    # production build
npm start        # serve the production build
npm test         # unit tests + DB integration tests (integration self-skips without DATABASE_ADMIN_URL)
npm run test:e2e # Playwright e2e (serial; needs seeded DB; uses E2E_TEST=1 reset endpoint)
npm run db:migrate  # apply migrations/*.sql via DATABASE_ADMIN_URL
npm run db:seed     # wipe+reseed items/events, upsert the two demo users
npx tsc          # typecheck only (tsconfig has noEmit: true); there is no lint script / no ESLint
```

Run a single test by name (vitest `-t` matches `describe`/`it` text):

```bash
npm test -- -t "shift-left"          # one test or block by substring
npx vitest                            # watch mode while iterating
```

## Architecture

Cadence models a product-development lifecycle (PDLC) as an **event-sourced state machine**, persisted in **MariaDB** behind Next.js Route Handlers. Read the layers in this order: `src/lib/engine.ts` → `src/server/commands.ts` → `src/server/repo/items.ts` → `src/components/App.tsx`.

**Write path (Phase 1):** the client never appends events directly. It POSTs a *command* (intent) to `/api/items/:id/commands` with an `expectedVersion` (= event count); the server locks the item row, re-runs the SAME pure engine, appends the resulting event, and returns it. 409 = stale version (client swaps in the fresh item), 422 = typed engine rejection (toast). `actor`/`role` always come from the session, never the request body. Auth is cookie-session (`users`/`sessions` tables, bcrypt); the runtime DB user has **no UPDATE/DELETE grant on `events`** (append-only enforced at the grant level). Work-item field *clears* travel as `null` in event payloads (`WiPatchWire`) because undefined doesn't survive JSON.

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
- **Persistence is MariaDB** (`migrations/`, `src/server/db.ts`) — do not introduce Postgres-specific SQL. All SQL lives in `src/server/repo/` and is parameterized. `src/lib/seed.ts` is now a fixture used by `db:seed` and the e2e reset endpoint; org/group sidebar structure is still static client metadata (hierarchy tables are future work).
- **`app/globals.css` is verbatim from the design prototype** in `prototype-handoff/` (oklch design tokens). Treat it as the source of truth for styling — extend it, don't re-author the design system from scratch.
- Imports use the `@/*` → `./src/*` path alias (tsconfig).
- The item hierarchy (org→group→team→epic→feature) is reconstructed in `Navigator` from the flat `Item.parent` field; there is no nesting table.
