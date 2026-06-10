# Cadence

Product-development-lifecycle (PDLC) tracker — Next.js implementation of the Claude Design prototype in `prototype-handoff/`.

Event-sourced core: the append-only event log is the single source of truth; current state, gate conditions, sign-offs, flags, sub-tracks and analytics are all derived by folding events.

## Features

- 12-state lifecycle spine + off-spine terminals (rejected / deferred / rolled back)
- Two AND-gates (Ready-for-dev, Release): condition checklists + dual PM/Dev sign-off
- Shift-left risk checklist that flips conditional gate conditions on
- Parallel security/compliance review sub-tracks feeding the release gate
- Plan-vs-actual timeline per phase, history timeline, analytics KPIs
- Role switch (Product / Engineering) with role-guarded actions, typed rejections as toasts
- Org → group → team → epic → feature navigator with search + lane filters
- Blocked / on-hold flags (orthogonal to state), iteration-child spawning
- Work items with per-type SDLC workflows (declarative flow tables, flow-checked moves)
- SDLC→PDLC rollup: "Work items complete" release condition auto-satisfies when all WIs are done
- Cross-feature kanban board (columns = WI states, swimlanes = features) with drag-drop + filters (text / type / phase / assignee / sprint)
- WI links (blocks / relates / duplicates) with derived inverse display; open blockers gate the move to done
- Manual backlog ranking (▲▼), phase binding (discovery/build/verify/release), sprint field
- Project-based hierarchy: projects own items, teams own projects (M:N), teams contain users (M:N)
- Scrum team spaces: members, owned projects, sprint picker, sprint board, ranked backlog, committed/done points

## Run

Requires MariaDB (Docker or native) and Node 18+.

```bash
npm install
cp .env.example .env.local        # then edit credentials

# Option A: Docker
docker compose up -d db           # MariaDB 11 on port 3307

# Option B: native MariaDB — create databases + users:
#   CREATE DATABASE cadence; CREATE USER 'cadence_admin'@'localhost' ...;
#   (see .env.example for the URLs the app expects)

npm run db:migrate                # apply migrations/ (admin connection)
npm run db:seed                   # demo items + two logins (printed once)
npm run dev                       # http://localhost:3000 → /login
```

Seed logins: `maya@cadence.dev` (Product) and `sam@cadence.dev` (Engineering) —
passwords printed by `db:seed`, overridable via `SEED_PM_PASSWORD` / `SEED_DEV_PASSWORD`.

## Verify

```bash
npm test           # engine + command-layer unit tests; DB integration tests
                   # run when DATABASE_ADMIN_URL is set (cadence_test schema)
npm run build      # production build
npm run test:e2e   # Playwright (serial; re-seeds via E2E-only reset endpoint)
```

Known: `npm audit` reports dev-tooling advisories in the vitest/vite chain
(never shipped to production); fixing requires a vitest major upgrade.

## Structure

- `src/lib/engine.ts` — pure event-sourced state machine (no React/DOM); runs on BOTH client (render) and server (command validation)
- `src/server/` — env, db pool, auth/sessions, zod command schemas + dispatcher, repositories (all SQL)
- `app/api/` — route handlers: auth, items, the single command mutation endpoint
- `migrations/` + `scripts/` — SQL migrations, migrate/seed runners (`db:migrate`, `db:seed`)
- `src/lib/seed.ts` — demo fixture (also used by `db:seed` and the e2e reset)
- `src/components/` — UI components (CSS in `app/globals.css`)
