# Phase 1 — Backend, MariaDB Persistence, Auth — Design Spec

**Date:** 2026-06-10
**Branch:** feat/cadence-pdlc-prototype (implementation on `feat/phase1-backend`)
**Status:** Spec for review — no code yet
**Depends on:** event-sourced engine as of `eb11a67` (SDLC layer merged)

## Goal

Take Cadence from a pure client-side, in-memory prototype to a multi-user app:
state survives refresh, every mutation is validated server-side, and actors are
real authenticated users. Nothing about the engine's semantics changes — the
append-only event log stays the single source of truth; it just moves into MariaDB.

## Non-goals (Phase 1)

- No real-time push (no websockets/SSE) — polling/refetch on focus is enough; conflicts are caught by optimistic concurrency.
- No RBAC beyond the existing `PM | Dev` roles (Phase 3 adds QA/Security/Compliance).
- No multi-tenancy/workspaces; one org per deployment.
- No SSO/OAuth — credentials login only (provider login is an add-on later).
- No event-log compaction/snapshots — item logs are small (tens of events); fold on read.

## Decisions (locked)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Server | **Next.js Route Handlers** (`app/api/*`) | Already on Next 15; one repo, one deploy; engine is shared TS either side |
| 2 | Database | **MariaDB** via `mysql2/promise` + hand-written SQL migrations | MariaDB locked by CLAUDE.md; schema is 5 tables — an ORM buys little; **no Postgres-specific SQL** |
| 3 | Mutation model | **Commands, not raw events** — client POSTs intent; server runs the engine, appends the resulting event | Server-side validation for free (same pure functions); client can never forge an illegal event |
| 4 | Concurrency | **Optimistic, per item** — command carries `expectedVersion` = event count; mismatch → 409 + fresh item; client re-derives and retries/toasts | Engine guards (gates, flows) must evaluate against the true latest log |
| 5 | Auth | Credentials + **httpOnly session cookie**, sessions table, bcrypt hashes | Boring and auditable; no JWT key management |
| 6 | Actor identity | `actor`/`role` on events come **from the session**, never the request body | Events are the audit trail; identity must be server-asserted |
| 7 | Role switch UI | Removed for authed users — role comes from the account; demo seed ships one PM + one Dev login | The switch was prototype chrome |
| 8 | Validation | **zod** at every API boundary (commands, auth payloads) | Project rule: schema-based validation, fail fast |
| 9 | IDs | Keep engine-generated string ids (`PAY-413`, `e17_x4x2`); DB does not mint ids, except `events.seq` (global append order) | Engine stays pure; seq gives a stable total order + cheap sync cursor later |

## Architecture

```
Browser (React, derives snapshots exactly as today)
   │  fetch /api/*  (cookie session)
   ▼
Next.js Route Handlers          src/server/
   ├─ withAuth() wrapper        auth.ts      (sessions, bcrypt, guards)
   ├─ zod command schemas       commands.ts  (command → engine call → event)
   ├─ repositories              repo/items.ts, repo/users.ts   (SQL only)
   └─ src/lib/engine.ts  ◄── SAME pure engine, now also imported server-side
   ▼
MariaDB (append-only events + items baseline + users/sessions)
```

- The engine never touches the DB. Repositories load `Item` (baseline + events),
  command layer calls the pure function, appends the returned event inside a
  transaction, returns `{ event, version }`.
- `deriveItem` keeps running client-side for rendering; the server runs it only
  inside command validation. No drift possible — same module.

## Schema (migrations/0001_init.sql)

```sql
CREATE TABLE items (
  id         VARCHAR(32)  PRIMARY KEY,
  title      VARCHAR(255) NOT NULL,
  area       VARCHAR(64)  NOT NULL,
  priority   ENUM('High','Medium','Low') NOT NULL,
  parent     VARCHAR(32)  NULL REFERENCES items(id),
  type       VARCHAR(16)  NOT NULL,
  stakeholders JSON NOT NULL,            -- [{role,name,derived?}]
  work_items   JSON NOT NULL,            -- seed baseline only; live WIs fold from events
  plan         JSON NULL,                -- {state: days} overrides
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE events (
  seq      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,  -- global append order
  id       VARCHAR(40) NOT NULL UNIQUE,                 -- engine event id
  item_id  VARCHAR(32) NOT NULL,
  type     VARCHAR(32) NOT NULL,
  actor    VARCHAR(128) NOT NULL,
  role     ENUM('PM','Dev') NOT NULL,
  ts       BIGINT NOT NULL,                             -- ms epoch (engine convention)
  payload  JSON NOT NULL,                               -- everything except the columns above
  CONSTRAINT fk_events_item FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_events_item_ts (item_id, ts, seq)
);
-- append-only: app user gets INSERT/SELECT only on events (no UPDATE/DELETE grants)

CREATE TABLE users (
  id            VARCHAR(36)  PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  role          ENUM('PM','Dev') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,        -- sha256(token); raw token only in the cookie
  user_id    VARCHAR(36) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_sessions_expiry (expires_at)
);

CREATE TABLE schema_migrations (
  version    VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Item **version** = `COUNT(*)` of its events (no stored column; computed in the
append transaction with `SELECT COUNT(*) ... FOR UPDATE` on the item row).

## API (envelope: `{ success, data?, error? }` per project rules)

| Method & path | Body (zod-validated) | Returns | Notes |
|---|---|---|---|
| `POST /api/auth/login` | `{email, password}` | `{user}` + sets cookie | rate-limited (5/min/IP) |
| `POST /api/auth/logout` | — | `{}` | deletes session row |
| `GET  /api/auth/me` | — | `{user}` | 401 if no session |
| `GET  /api/items` | — | `{items: Item[], versions}` | full logs; initial load + refetch |
| `GET  /api/items/:id` | — | `{item, version}` | used for 409 recovery |
| `POST /api/items/:id/commands` | `{command, expectedVersion}` | `{event, version}` or typed rejection | THE mutation endpoint |
| `POST /api/items` | `{spawnFrom}` (iteration) | `{item, parentEvent}` | creates child + SPAWN_CHILD atomically |

### Command union (mirrors engine functions 1:1)

```ts
type Command =
  | { kind: "transition";  to: StateKey; reason: string | null }
  | { kind: "condition";   op: "satisfy" | "waive" | "reset"; key: string }
  | { kind: "signoff";     gate: GateKey; clear?: boolean }
  | { kind: "shiftLeft";   risk: string; value: boolean }
  | { kind: "subtrack";    track: TrackKey; to: SubtrackState }
  | { kind: "flag";        flag: FlagKey; value: boolean; reason: string | null }
  | { kind: "wiCreate";    draft: {...} }
  | { kind: "wiUpdate";    wiId: string; patch: Partial<WorkItem> }
  | { kind: "wiDelete";    wiId: string }
  | { kind: "wiComment";   wiId: string; text: string }
  | { kind: "wiMove";      wiId: string; to: WiState }          // flow-checked
  | { kind: "wiLink";      wiId: string; type: WiLinkType; target: string }
  | { kind: "wiUnlink";    wiId: string; type: WiLinkType; target: string }
  | { kind: "wiReorder";   wiId: string; toIndex: number };
```

Server flow per command (single DB transaction):
1. `SELECT ... FOR UPDATE` item row; load events; `version = count`.
2. `version !== expectedVersion` → 409 `{error: "stale", item, version}`.
3. Dispatch to the matching engine function with `actor = session.user.name`,
   `role = session.user.role`. Engine rejection → 422 with the typed rejection
   (client toasts exactly as today).
4. INSERT event; commit; return `{event, version: version + 1}`.

Engine role guards keep working untouched — they just receive a trustworthy role.

## Client changes (App.tsx)

- `items` loads from `GET /api/items` (loading state + error banner); refetch on
  window focus and after every 409.
- `append()` becomes `sendCommand(itemId, command)`: optimistic local append of
  the *predicted* event (engine runs client-side first for instant UX), then
  reconcile with the server event; on 409/422 roll back + toast + refetch item.
- Login page (`/login`); authed layout gate; `actor`/role badge from `/api/auth/me`.
- Role switch removed (Decision 7). `CURRENT_USER` constant dies.

## Security checklist (must hold before merge)

- [ ] bcrypt cost ≥ 12; constant-time compare via bcrypt.compare
- [ ] Session cookie: `httpOnly`, `secure` (prod), `sameSite=lax`, 7-day expiry, token random 32 bytes, only the **hash** stored
- [ ] Login rate limit + generic "invalid credentials" error (no user enumeration)
- [ ] All SQL via parameterized `mysql2` prepared statements — zero string-built SQL
- [ ] zod-validate every body; reject unknown command kinds
- [ ] `DATABASE_URL`, `SESSION_SECRET` from env, validated at startup, never logged
- [ ] DB app user: no UPDATE/DELETE grant on `events`
- [ ] Error responses never leak SQL/stack; details go to server log only

## Local dev & ops

- `docker-compose.yml` with `mariadb:11` (port 3307, volume) — `docker compose up -d db`.
- `.env.local`: `DATABASE_URL=mysql://cadence:***@localhost:3307/cadence`, `SESSION_SECRET=...` (`.env.example` checked in).
- `npm run db:migrate` — node script, runs `migrations/*.sql` in order, records in `schema_migrations`.
- `npm run db:seed` — ports `buildSeed()` into INSERTs + two users: `maya@cadence.dev` (PM), `sam@cadence.dev` (Dev), seed-only passwords printed once.

## Testing

- Engine tests: untouched (engine unchanged).
- Repository + command-layer integration tests (vitest): run against a throwaway
  schema on the docker DB; auto-skip with a warning when `DATABASE_URL` absent.
- API tests: command validation, 401/409/422 paths, session lifecycle.
- E2E: playwright `webServer` boots with seeded test DB; add login step to helpers;
  existing 18 specs keep passing behind auth.
- Coverage target stays 80%+ on `src/server/**`.

## Task list (implementation order)

1. **1a Infra** — docker-compose, env validation, `db.ts` pool, migration runner + 0001 schema, seed script. *(gate: `db:migrate` + `db:seed` idempotent)*
2. **1b Auth** — users/sessions repo, login/logout/me routes, `withAuth`, login page, rate limit. *(gate: API tests green)*
3. **1c Commands** — zod schemas, command dispatcher, items repo, `GET /api/items`, optimistic-concurrency transaction. *(gate: integration tests incl. 409 race test)*
4. **1d Client** — load from API, sendCommand + reconcile, login flow, remove role switch, loading/error states. *(gate: all e2e green with auth)*
5. **1e Hardening** — security checklist sweep, security-reviewer agent pass, README/CLAUDE.md update.

Each step lands as its own commit; engine untouched throughout (any engine change is a spec violation — stop and re-review).

## Risks

| Risk | Mitigation |
|------|-----------|
| `Date.now()`/`Math.random()` in `ev()` server-side — id collisions across processes | acceptable now (single process); seq UNIQUE constraint catches collisions → retry once |
| Optimistic concurrency thrash with 2+ users on one item | per-item scope keeps blast radius tiny; refetch-on-409 converges; real-time push is Phase 4 |
| WSL/Windows: no Docker | document native MariaDB install path in README as fallback |
| JSON columns make ad-hoc SQL reporting harder | events.payload is read only by the engine; reporting reads come later via derived read models |

## Open questions (defaults chosen; flag to change)

1. Password policy — default: min 10 chars, no composition rules (NIST-style).
2. Session length — default 7 days sliding. Shorter?
3. Should `GET /api/items` paginate? Default no — item count is small; revisit at >200 items.
