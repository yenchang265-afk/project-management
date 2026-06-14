# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server → http://localhost:3000 (needs MariaDB + .env.local)
npm run build    # production build (route modules may export ONLY HTTP handlers — see gotchas)
npm start        # serve the production build
npm test         # unit tests + DB integration tests (integration self-skips without DATABASE_ADMIN_URL)
npm run test:e2e # Playwright e2e (serial; needs seeded DB; uses E2E_TEST=1 reset endpoint)
npm run db:migrate  # apply migrations/*.sql via DATABASE_ADMIN_URL
npm run db:seed     # wipe+reseed items/events + structure, upsert the two demo users
npx tsc          # typecheck only (tsconfig has noEmit: true); there is no lint script / no ESLint
```

Run a single test by name (vitest `-t` matches `describe`/`it` text):

```bash
npm test -- -t "shift-left"          # one test or block by substring
npx vitest                            # watch mode while iterating
```

**Local DB:** `docker-compose.yml` runs MariaDB on **port 3307** (native installs usually use 3306 — see `.env.example`). Two DB users by design: the runtime app user (least privilege, no UPDATE/DELETE on `events`) and an admin user for migrations/seeding (DDL rights).

**Env (`.env.example`):** required = `DATABASE_URL`, `SESSION_SECRET` (32+ bytes), validated at startup by `src/server/env.ts` (fail-fast, never logs values). Optional & **feature-gated** — unset disables the feature cleanly: `DEV_AUTH_BYPASS=1` (skip login in dev, ignored in prod), `AUTOMATION_TICK_SECRET` (enables `POST /api/automations/tick`), `ANTHROPIC_API_KEY` (advisory AI, G-27), `OIDC_*` ×4 (SSO, G-28). `DATABASE_ADMIN_URL` only needed by migrate/seed.

## Architecture

Cadence models a product-development lifecycle (PDLC) as an **event-sourced state machine**, persisted in **MariaDB** behind Next.js Route Handlers. The original engine (Phase 1) is the core; a large **Jira-parity layer** (gaps G-1..G-28, phases 7–16) wraps it with project-management surfaces. Read the core first: `src/lib/engine.ts` → `src/server/commands.ts` → `src/server/repo/items.ts` → `src/components/App.tsx`.

**Write path (Phase 1):** the client never appends events directly. It POSTs a *command* (intent) to `/api/items/:id/commands` with an `expectedVersion` (= event count); the server locks the item row, re-runs the SAME pure engine, appends the resulting event, and returns it. 409 = stale version (client swaps in the fresh item), 422 = typed engine rejection (toast). `actor`/`role` always come from the session, never the request body. Auth is cookie-session (`users`/`sessions` tables, bcrypt); the runtime DB user has **no UPDATE/DELETE grant on `events`** (append-only enforced at the grant level). Work-item field *clears* travel as `null` in event payloads (`WiPatchWire`) because undefined doesn't survive JSON.

**Post-append fan-out** (in the commands route, after a successful append): `notifyAfterCommand` (watchers + @mentions), `fireWebhooks`, and `runAutomation` are all fired **best-effort with `void`** — a failure in any of them must never fail the command. New side effects on the write path follow this same pattern.

### The engine is the whole system (`src/lib/engine.ts`)
Pure data + pure functions, zero React/DOM. The append-only **event log is the single source of truth**; everything else is derived:

- `deriveItem(item)` folds an item's `events[]` into a live `Snapshot` (current `state`, `conditions`, `flags`, `signoffs`, `subtracks`, `children`, `activeRisks`). Called fresh on every render — never cache a snapshot as mutable state.
- `applyTransition(item, toState, actor, role, reason)` is the only mover. It **never throws**: returns `{ ok: true, event }` or `{ ok: false, rejection }` where `rejection.type` is one of `ILLEGAL_TRANSITION | ROLE_GUARD | GATE_CONDITIONS_UNSATISFIED | GATE_SIGNOFF_MISSING | REASON_REQUIRED`. The UI renders rejections as toasts.
- `ev(...)` constructs events. Analytics (`timeInState`, `reworkRate`, `leadTime`, `planVsActual`) are also pure folds over the log.

### Rules live in declarative tables, not in code branches
To change lifecycle behaviour, **edit the data tables, not the functions**:

- `STATES` — 12 on-spine states (`spine: 0..11`) across lanes discovery→build→verify→release→closed, plus 3 off-spine terminals (`rejected`, `deferred`, `rolled_back`).
- `TRANSITIONS` — the **only** place transition rules live: `{from, to, roles, kind, gate?, needsReason?}`. `legalTransitions(state)` and `applyTransition` both read it. (G-13 lets a project override this set via a DB-backed workflow scheme — see below.)
- Gates are modelled as a `gate` **property on a transition** (see `GATE_BEFORE`), not as bespoke states. A gate opens only when `blocking.length === 0` **and** dual PM **and** Dev sign-off are present (`gateStatus`).
- `GATES` — conditions per gate; `base: "required"` must be satisfied, `base: "not_applicable"` + `conditional: true` are off by default.
- `SHIFT_LEFT` — ticking a risk flips its mapped conditional conditions `not_applicable → required` (and reverts when unticked, unless already satisfied/waived). This is recomputed in a second pass inside `deriveItem`.
- `SUBTRACK_FLOW` — `security`/`compliance` mini state machines (`pending→in_review→changes_requested↔in_review→approved`). They run concurrently and never block the spine; an `approved` sub-track **auto-satisfies** its linked release-gate condition.
- `WI_FLOW_BASE` / `WI_FLOW_OVERRIDES` — per-type work-item workflows. `transitionWorkItem` is the flow-checked mover (also rejects a move to `done` while open `blocks` links point at the item — see `wiBlockedBy`); `updateWorkItem` stays a free-form admin edit, state included. The `work_complete` release condition is a **derived rollup**: auto-satisfied in `deriveItem` when every work item is `done` (vacuously true with none), reverting if one reopens — explicit satisfy/waive events always win.
- Work items also carry `phase` (discovery/build/verify/release — board swimlane + spine bridge), `sprint`, `links` (`WI_LINK`/`WI_UNLINK` events; dangling links to tombstoned targets are dropped at derive time), manual rank (`WI_REORDER` stores the full ordered id list; later creations append), plus Jira-parity fields: subtasks, time tracking (estimate/logged), custom-field values, labels/components, comments (`WiComment`, @mention source).

### UI ↔ engine loop (`src/components/App.tsx`)
`App` holds `items: Item[]` in `useState` (seeded once from `buildSeed(Date.now())`) and the current `role` (`"PM" | "Dev"`). Every action follows the same pattern:

1. call an engine function (e.g. `applyTransition`) → get an event,
2. `append(itemId, event)` updates state **immutably**: `{ ...it, events: [...it.events, event] }` — never mutate the existing item or its events,
3. re-render derives a fresh snapshot via `deriveItem(item)`.

Condition toggles, sign-offs, shift-left ticks, sub-track moves, flag sets, and child spawns are all just `ev(...)` appends. Role-switching (`setRole`) flips which actions/sign-offs are permitted — guards are enforced in the engine, not the UI. Components consume engine tables/functions directly. `app/page.tsx` renders `App` client-side to avoid an SSR hydration mismatch (the engine uses `Date.now()`/`Math.random()`). The chrome is Jira-style two-tier (icon rail ⇄ labeled drawer + project sidebar); most cards/panels are collapsible (`CollapsibleCard`).

### Jira-parity layer (phases 7–16)
Built ON the engine, never around it — every mutation that touches lifecycle still goes through the command path so guards hold. Each subsystem is a `repo/*.ts` (parameterized SQL) + `app/api/*/route.ts` + one or more components. Pure logic lives in `src/lib/*` with unit tests:

- **Registries** (`repo/registries.ts`, `repo/fields.ts`, `repo/versions.ts`): labels, components, custom-field defs, fix-versions/releases. PM-only metadata (`manage_metadata`).
- **Filters + CQL** (`lib/cql.ts`, `repo/filters.ts`): a query language for the list view — fielded predicates, saved filters, **relative-date filters** (`now`, `±Nd/Nw`, start/end of week/month). `wiToCqlRow` adapts a derived work item to a queryable row; reused by automation conditions.
- **Views**: `ListView` (CQL + CSV export via `lib/csv.ts`), `TimelineView` (roadmap), `CalendarView` (`lib/calendar.ts`), `BacklogView`, `Board` (per-column **WIP limits**, `lib/wip.ts`), `DashboardView`/`DashboardGadgets` (per-user prefs), `OrgView`, `ProjectSummaryView`.
- **Reports** (`lib/reports.ts`, `lib/charts.ts`, `Reports.tsx`): burnup, cycle-time control chart, velocity, plus the engine's plan-vs-actual.
- **Sprints** (`lib/sprints.ts`, `repo/sprints.ts`): scrum sprints + capacity (`CapacityCard`); `TeamSpace` is the team's scrum board.
- **Goals/OKRs** (`lib/goals.ts`, `repo/goals.ts`, `GoalsCard`).
- **Automation** (`server/automation.ts`, `repo/automations.ts`, `AutomationBuilder`): event-triggered OR scheduled (`SCHEDULE_TRIGGER`, ticked via `/api/automations/tick`) rules; optional CQL condition; actions replay through `applyCommandAsSystem` so flows/gates still apply. **Loop guard**: automation-authored events carry actor `automation:…` and are ignored on re-trigger (one hop).
- **Webhooks** (`server/webhook-dispatch.ts`, `repo/webhooks.ts`): HMAC-SHA256-signed fire-and-forget POSTs, one retry, dead-letter.
- **API tokens** (`repo/tokens.ts`), **attachments** (`repo/attachments.ts`, `server/uploads.ts`), **forms/intake** (`repo/forms.ts`, `app/intake/[token]`), **announcements** (`repo/announcements.ts`), **audit log** (`repo/audit.ts`, `AuditLog`, PM-only `view_audit`), **bulk ops** (`server/bulk.ts`), **notifications** (`repo/notifications.ts`, `server/notify.ts`, `server/mailer.ts`, per-user prefs).
- **Workflow schemes (G-13)** (`repo/workflows.ts`, `server/workflow-schema.ts`, `WorkflowEditor`): DB-backed per-project override of `TRANSITIONS`, validated for spine reachability + gate placement.
- **AI (G-27, opt-in)** (`server/ai.ts`, `AiSuggestButton`): advisory only — model output is text a human acts on through the normal command path; never auto-applied. Pure prompt builders are unit-tested; only `ask` calls the model (`claude-opus-4-8`).
- **SSO (G-28, opt-in)** (`server/sso.ts`): OIDC auth-code + PKCE via `openid-client`; maps verified id_token email to an EXISTING users row (no JIT provisioning). Password auth is the untouched default.

### Conventions & gotchas
- **Persistence is MariaDB** (`migrations/0001`–`0020`, `src/server/db.ts`) — do not introduce Postgres-specific SQL. All SQL lives in `src/server/repo/` and is parameterized. `src/lib/seed.ts` is a fixture used by `db:seed` and the e2e reset endpoint.
- **Route modules export ONLY HTTP handlers.** Next.js production build breaks if a route file exports anything else (e.g. a shared zod schema). Put shared schemas/helpers in `src/server/*` (see `workflow-schema.ts`, `http.ts`) and import them.
- **Access scoping** (`server/scope.ts`): a non-PM user sees only what their team memberships reach (Company→Org→Team→Project→Item). Enforced server-side on every read/write surface — out-of-scope items 404. PM/admin is unrestricted. `scopeStructure` trims the read-side; the org *directory* stays visible to all but member detail does not leak.
- **Permissions matrix** (`server/permissions.ts`): the ONE source of truth for who-may-do-what. Add a key to `PERMISSIONS` and guard with `requirePerm(user, action)` — never inline role checks in routes.
- **API envelope & validation**: responses use `{ success, data?, error? }`; parse bodies with `parseBody(req, schema)` (`server/http.ts`). Repo writes return `{ok:false,error}` for expectable conflicts (mapped to 422). Rate limiting via `server/rate-limit.ts`.
- **Hierarchy is project-based** (Phase 2): `items.project_id` → `projects`; `project_teams` (a project can be owned by MULTIPLE teams) and `team_members` (a team contains multiple users) are both M:N; orgs sit above teams (`migrations/0003`). `GET /api/structure` serves the whole (scoped) read-side. `item.area` is a display label only. Spawned iteration children inherit the parent's `project_id`.
- **Admin writes** (PM-only via the permissions matrix): projects/teams/orgs/sprints/metadata/workflows. Writes live in `repo/structure.ts` etc.; item→project assignment is a direct column update, NOT an event — project membership is metadata, not lifecycle. The e2e reset endpoint restores the seed hierarchy (extra runtime-created rows are wiped).
- **`app/globals.css` is verbatim from the design prototype** in `prototype-handoff/` (oklch design tokens). Treat it as the source of truth for styling — extend it, don't re-author the design system from scratch.
- Imports use the `@/*` → `./src/*` path alias (tsconfig).
- The item hierarchy (org→group→team→epic→feature) is reconstructed in `Navigator` from the flat `Item.parent` field; there is no nesting table.
