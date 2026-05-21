# Implementation Plan — Must Have Features

Companion to `FEATURES.md`. This plan covers all 8 **Must Have** categories using a TypeScript full-stack and a vertical-slice subagent model with TDD on every slice.

---

## Progress Tracker

### Phase 0 — Foundation

- [x] `package.json` with full script set
- [x] `docker-compose.yml` (Postgres, Mailpit, MinIO)
- [x] Prisma schema (User placeholder) + first migration
- [x] Auth.js skeleton
- [x] Vitest + Playwright + Testcontainers configured with canary tests
- [x] GitHub Actions CI (lint, typecheck, unit, integration, e2e, build)
- [x] `.env.example`, README dev setup
- [x] ESLint, Prettier, strict `tsconfig`
- [x] Pre-commit hook + PR template

### Phase 1 — Identity & Access

- [x] Schema: Auth.js tables + Role enum + OrgMembership
- [x] Service tests + impl: register/hash/verify, reset token, RBAC
- [x] Integration tests + impl: `/api/auth/*`, session, RBAC middleware
- [x] E2E: register → verify → login → logout → reset
- [x] UI: login, register, forgot-password, reset-password, profile
- [x] Cross-cutting: `requireUser/requireRole/requireProjectAccess` helpers

### Phase 2 — Projects

- [x] Schema: Project, ProjectMember, IssueCounter
- [x] Service: CRUD, key format, atomic issue counter
- [x] Integration: RBAC for rename/archive
- [x] E2E: create → list → archive
- [x] UI: `/projects`, `/projects/new`, settings
- [x] Export `getProjectByKey(key, user)`

### Phase 3 — Issues

- [x] Schema: Issue, Label, Comment, Attachment, IssueLink, ActivityLogEntry
- [x] Service tests + impl: CRUD, transitions, @mentions, links, activity log
- [x] Integration: RBAC matrix, pagination, filters, attachment flow
- [x] E2E: create → comment → transition → attach → link
- [x] Domain event emitter on bus
- [x] UI: issue detail, create dialog, Tiptap composer, dropzone

### Phase 4 — Parallel Slices

- [ ] 4a Boards: kanban + backlog + search (tsvector) + saved filters
- [ ] 4b Sprints: schema, start/complete, board view, burndown
- [ ] 4c Notifications: in-app + email, event subscribers, preferences
- [ ] 4d Dashboard: assigned-to-me, activity feed, project tiles

### Phase 5 — Cross-Cutting Polish

- [ ] 5a Audit log surface (admin view + CSV export)
- [ ] 5b API hardening: cursor pagination, OpenAPI, rate limit, backup runbook

### Final Verification

- [ ] Fresh-clone bootstrap passes all test tiers
- [ ] Manual smoke covers golden path
- [ ] CI green on `main`
- [ ] Coverage ≥85% on `/src/server/services`

---

## 1. Stack & Tooling

| Concern                | Choice                                                         |
| ---------------------- | -------------------------------------------------------------- |
| Framework              | Next.js 15 (App Router, RSC + server actions)                  |
| Language               | TypeScript (strict)                                            |
| ORM / DB               | Prisma + PostgreSQL 16                                         |
| Auth                   | Auth.js (NextAuth v5) with credentials + email magic link      |
| Validation             | Zod (shared schemas API ↔ UI)                                  |
| UI                     | Tailwind CSS + shadcn/ui + Radix primitives                    |
| Drag & drop            | `@dnd-kit/core`                                                |
| State (client)         | TanStack Query for server state; Zustand for local UI state    |
| Rich text              | Tiptap                                                         |
| Background jobs        | `pg-boss` (Postgres-backed queue, no extra infra)              |
| Email                  | Resend (dev: Mailhog/Mailpit via Docker)                       |
| File storage           | S3-compatible (MinIO in dev)                                   |
| Unit/integration tests | Vitest + Testing Library                                       |
| API contract tests     | Vitest + `supertest`-style harness against Next route handlers |
| E2E tests              | Playwright                                                     |
| Lint/format            | ESLint + Prettier + `tsc --noEmit`                             |
| CI                     | GitHub Actions (lint → typecheck → unit → integration → e2e)   |
| Dev orchestration      | `docker compose` (Postgres + Mailpit + MinIO)                  |

## 2. Repository Layout

```
/app                  Next.js App Router routes (RSC, server actions, route handlers)
/src
  /server
    /db               Prisma client + repositories
    /auth             Auth.js config, session helpers
    /services         Domain services (issueService, sprintService, ...)
    /jobs             pg-boss workers (email, notifications)
    /events           Domain event bus (in-process, used by notifications + audit)
  /lib                Shared utilities (zod schemas, error types)
  /ui                 Reusable UI components
/prisma
  schema.prisma
  /migrations
/tests
  /unit               Mirrors /src structure
  /integration        Hits route handlers + real Postgres test container
  /e2e                Playwright specs (auth, issues, board, sprint, notifications)
```

## 3. TDD Methodology

Every feature slice follows **red → green → refactor** at three layers:

1. **Domain service test** (unit, Vitest, in-memory) — define behavior and edge cases first.
2. **Route handler / server action test** (integration, real Postgres via Testcontainers) — auth, validation, persistence, authorization.
3. **E2E test** (Playwright) — one golden-path scenario per slice.

Rules for every subagent:

- Write the failing test before the implementation. Do not write production code without a red test.
- Coverage gate: ≥85% line coverage on `/src/server/services`. UI components require Testing Library smoke tests only.
- Factories live in `tests/factories/*.ts` — reuse, never inline fixtures.
- Each PR must show the test diff alongside the implementation diff.

## 4. Subagent Orchestration Model

Vertical slices: one agent owns DB → service → route → UI → tests for its feature. Dependency graph dictates what runs sequentially vs. in parallel.

```
Phase 0 (sequential, 1 agent):  Foundation
Phase 1 (sequential, 1 agent):  Identity & Access      ── blocks all below
Phase 2 (sequential, 1 agent):  Projects               ── blocks Issues
Phase 3 (sequential, 1 agent):  Issues core            ── blocks Boards/Sprints/Notifications/Dashboard
Phase 4 (parallel, 4 agents):   Boards | Sprints | Notifications | Dashboard
Phase 5 (parallel, 2 agents):   Search/Filters | Audit Log & Pagination polish
```

Each agent gets a self-contained prompt that includes: scope, schema additions allowed, contract with adjacent slices, the acceptance test list, and explicit "out of scope" items.

---

## 5. Phase 0 — Foundation (sequential, ~1 agent-day)

**Goal:** an empty Next.js app that boots, talks to Postgres, runs all test tiers in CI.

Deliverables:

- `package.json` with scripts: `dev`, `build`, `start`, `test`, `test:int`, `test:e2e`, `lint`, `typecheck`, `db:migrate`, `db:seed`.
- `docker-compose.yml` (Postgres, Mailpit, MinIO).
- Prisma schema with only `User` placeholder; first migration applied in CI against ephemeral Postgres.
- Auth.js skeleton wired (no providers yet).
- Vitest + Playwright + Testcontainers configured. One canary test per tier.
- GitHub Actions workflow: lint, typecheck, unit, integration, e2e, build. PRs blocked on green.
- `.env.example`, `README.md` dev setup.
- ESLint, Prettier, `tsconfig` with `strict: true`, `noUncheckedIndexedAccess: true`.
- Pre-commit hook (lint-staged) and PR template.

Exit criteria: `pnpm test && pnpm test:int && pnpm test:e2e` all green on a fresh checkout.

---

## 6. Phase 1 — Identity & Access (sequential)

**Schema:** `User`, `Account`, `Session`, `VerificationToken` (Auth.js), `Role` enum (`ADMIN`, `LEAD`, `MEMBER`, `VIEWER`), `OrgMembership`.

**Tests first:**

- Service: register/hash/verify credentials; password reset token lifecycle; role permission checks.
- Integration: `/api/auth/*` flows, session cookie set, RBAC middleware returns 403 for insufficient role.
- E2E: register → verify email (Mailpit) → log in → log out → reset password.

**UI:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/profile`. Avatar upload to MinIO.

**Cross-cutting deliverable:** `requireUser()`, `requireRole()`, `requireProjectAccess()` helpers — every subsequent slice uses these. Document their contract in `/src/server/auth/README.md`.

---

## 7. Phase 2 — Projects (sequential)

**Schema:** `Project { id, key (unique), name, description, leadId, archivedAt }`, `ProjectMember { projectId, userId, role }`, `IssueCounter { projectId, lastNumber }`.

**Tests first:**

- Service: create/rename/archive; key uniqueness + format `[A-Z]{2,10}`; auto-increment issue number atomically.
- Integration: only LEAD/ADMIN can rename or archive; VIEWER cannot.
- E2E: create project → see it in list → archive → confirm hidden from default list.

**UI:** `/projects`, `/projects/new`, `/projects/[key]/settings`.

**Contract for downstream slices:** projects expose `getProjectByKey(key, user)` returning `{ project, viewerRole }` — Issues slice depends on this.

---

## 8. Phase 3 — Issues (sequential, the keystone slice)

**Schema:** `Issue { id, projectId, number, key (computed), title, description, type, priority, status, assigneeId, reporterId, dueDate, estimate, createdAt, updatedAt }`, `Label`, `IssueLabel`, `Comment`, `Attachment`, `IssueLink { fromId, toId, type }`, `ActivityLogEntry { issueId, actorId, field, before, after, at }`.

**Tests first (this slice has the most tests — invest heavily):**

- Service: create/update/delete with field-level diff → activity log entries emitted; transition validation against allowed states; @mention parsing; link constraints (no self-link, no duplicate link).
- Integration: full RBAC matrix per field; pagination on list; filter combinations; attachment upload signed URL flow.
- E2E: create issue → comment with @mention → change status → attach file → link to another issue → verify activity timeline.

**Server-side events:** every mutation emits a domain event on the in-process event bus (`issue.created`, `issue.updated`, `issue.commented`, `issue.transitioned`). Notifications and Audit Log subscribe in later phases — out of scope here, but the emitter contract must exist.

**UI:** issue detail page (`/projects/[key]/issues/[number]`), issue create dialog, inline edit, comment composer (Tiptap), attachment dropzone.

---

## 9. Phase 4 — Parallel Slices

Four agents run concurrently. Each must only consume the public contracts of Phases 1–3; none may modify Issue/Project schemas (additive migrations to _their_ tables only).

### 9a. Boards & Views

- Schema additions: `SavedFilter { id, userId, projectId?, name, query (jsonb) }`.
- Kanban board (`/projects/[key]/board`) with `@dnd-kit`, columns from project workflow.
- Backlog list view with sort/filter.
- Issue search: server-side full-text on `title + description` (Postgres `tsvector` + GIN index).
- Saved filters CRUD.
- Tests: service for filter query → SQL; E2E for drag-drop transitions a real issue.

### 9b. Sprints

- Schema: `Sprint { id, projectId, name, goal, state (PLANNED/ACTIVE/COMPLETED), startDate, endDate }`, `SprintIssue { sprintId, issueId, rank }`.
- Routes: create, start (only one ACTIVE per project), complete (moves incomplete issues back to backlog).
- Active sprint board view; burndown computed from activity log status transitions.
- E2E: plan sprint → start → move issues to Done → complete → verify burndown end-state.

### 9c. Notifications

- Schema: `Notification { id, userId, kind, payload (jsonb), readAt, createdAt }`, `NotificationPreference { userId, channel, kind, enabled }`.
- Subscribe to `issue.*` events from Phase 3. Fan-out: assignee, reporter, mentioned users, watchers.
- In-app: bell icon + drawer; mark read; mark all read.
- Email: pg-boss job consumes notification → Resend/Mailpit.
- E2E: user A @mentions user B → user B sees in-app notification and receives email in Mailpit.

### 9d. Dashboard / Home

- `/` (when authed) shows: "Assigned to me", "Recent activity" (from audit log), project tiles.
- Pure read-model queries against existing tables; no schema changes.
- Tests: service-level query correctness with seeded data; E2E for the three sections rendering.

---

## 10. Phase 5 — Cross-Cutting Polish (parallel, 2 agents)

### 10a. Audit Log surface

- Already populated via `ActivityLogEntry` (Issues) — add org-level audit for auth events, project changes, role changes.
- Admin-only `/admin/audit` view with filtering and CSV export.

### 10b. API + Pagination Hardening

- Standardize cursor pagination across all list endpoints; document with OpenAPI generated from Zod schemas (`zod-to-openapi`).
- Rate limiting middleware (`@upstash/ratelimit` or in-Postgres token bucket) on auth + write endpoints.
- Response envelope: `{ data, pageInfo }`. Error envelope: `{ error: { code, message, details } }`.
- Backup script (`pg_dump` cron-friendly) and restore runbook in `/docs/ops.md`.

---

## 11. Acceptance Gate (every slice)

A slice is "done" only when:

1. All three test tiers exist and pass in CI.
2. Coverage gate met on `/src/server/services`.
3. `pnpm typecheck && pnpm lint` clean.
4. No `// TODO` referencing the slice's own scope.
5. `README.md` of that domain updated (public contract + how to extend).
6. One Playwright E2E covering the golden path.
7. PR description includes: schema diff, new env vars (if any), test-list checklist.

## 12. Verification (end-to-end)

After all phases:

1. Fresh clone → `docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm test:all` — all green.
2. `pnpm dev` → manual smoke: register two users, create project, create issue, @mention, drag on board, run a sprint, see notifications, view dashboard.
3. CI on `main` shows green across lint/type/unit/integration/e2e/build.
4. Coverage report ≥ 85% on services.

## 13. Suggested Sequencing Summary

| Phase                                          | Agents in parallel | Blocking? |
| ---------------------------------------------- | ------------------ | --------- |
| 0 Foundation                                   | 1                  | Yes       |
| 1 Identity & Access                            | 1                  | Yes       |
| 2 Projects                                     | 1                  | Yes       |
| 3 Issues                                       | 1                  | Yes       |
| 4 Boards / Sprints / Notifications / Dashboard | 4                  | No        |
| 5 Audit / API polish                           | 2                  | No        |

Total critical path: ~4 sequential agent-units + 1 parallel wave + 1 polish wave.
