# Jira Feature Parity — Gap Analysis & Implementation Plan

Date: 2026-06-11
Source: https://www.atlassian.com/software/jira/features (marketing categories: Plan / Track / Collaborate / Report / Admin & Integrations), expanded with Jira's concrete product feature set.
Baseline: Cadence as of phase 6 (partial) — commit `aadafcb`.

## 1. What Cadence already has (Jira-equivalent)

| Jira feature | Cadence equivalent | Status |
|---|---|---|
| Issue types (epic/story/task/bug) | Items + work items, types epic/feature/story/task/bug | ✅ |
| Custom workflows | Declarative `TRANSITIONS`/`GATES`/`WI_FLOW_*` tables in `engine.ts` | ✅ engine, but hardcoded (see G-13) |
| Kanban board | `Board.tsx` cross-feature board, swimlanes by feature/phase, drag-drop, filters | ✅ |
| Scrum board + backlog | `TeamSpace.tsx` sprint board, ranked backlog, committed/done points | ✅ |
| Sprints | First-class `sprints` table (future/active/closed) | ✅ |
| Story points / priority / severity | WI fields | ✅ |
| Issue links | WI links (blocks/relates/duplicates) + item links (engine only) | ⚠️ item-link UI missing |
| Comments | Item comments + WI comments | ✅ |
| Watchers | WATCH_SET events + notification on change | ✅ |
| Notifications | `notifications` table + bell UI | ⚠️ @mention kind partially wired |
| Burndown / velocity / CFD | `reports.ts` folds + `Reports.tsx` | ✅ |
| History / changelog | Event-sourced log per item, `History.tsx` | ✅ (per item, not global) |
| Search | `/api/search` substring search + filters | ⚠️ no query language, no saved filters |
| Bulk change | `/api/items/bulk` (1–50 ops) | ✅ |
| Projects / teams / org | projects, project_teams, team_members, orgs | ✅ |
| Permissions | PM/Dev role guards; permissions matrix (phase 6, partial) | ⚠️ coarse |
| Dashboards | `DashboardView.tsx` (fixed KPIs, lane bar, my work, CFD) | ⚠️ not customizable |
| Goals / OKR alignment | — (approximated by gates + plan-vs-actual) | ⚠️ |

Cadence also has things Jira doesn't ship out of the box (keep, don't regress): event-sourced append-only log, PDLC spine with hard gates, dual sign-offs, shift-left risk → conditional gate conditions, parallel security/compliance sub-tracks, plan-vs-actual.

## 2. Gap list

| # | Jira feature | Gap in Cadence |
|---|---|---|
| G-1 | Timeline / roadmap (Gantt) | No timeline view; no epic/feature bars, no dependency arrows |
| G-2 | Calendar view | None |
| G-3 | List (spreadsheet) view | None; only board/navigator |
| G-4 | Summary view (project overview) | Partial (dashboard is global, not per-project) |
| G-5 | Custom fields | None — WI fields are a fixed set |
| G-6 | Attachments | None |
| G-7 | Labels & components | Tags exist; no components, no label management |
| G-8 | Subtasks | WIs have no children |
| G-9 | Time tracking (estimates, worklogs) | Story points only; no original/remaining estimate, no worklog |
| G-10 | Versions / releases (release hub) | No versions entity; spine has deploying/released states but nothing groups items into a release |
| G-11 | JQL + saved filters + quick filters | Substring search only |
| G-12 | Customizable dashboards (gadgets) | Fixed dashboard |
| G-13 | Workflow editor / per-project workflows | Transition tables compiled into `engine.ts` |
| G-14 | Automation rules (no-code trigger/condition/action) | None |
| G-15 | Forms / intake requests | None |
| G-16 | Goals (align work to goals) | None |
| G-17 | Reports: burnup, sprint report, control chart (cycle time), created-vs-resolved, version/epic report | Only burndown/velocity/CFD (engine folds `timeInState`/`leadTime`/`reworkRate` exist, no UI) |
| G-18 | Dependency management cross-team (Plans / Advanced Roadmaps) | WI/item links exist; no cross-project planning, capacity view, or scenario planning |
| G-19 | @mentions | Partially wired |
| G-20 | Email notifications / notification schemes | In-app only |
| G-21 | Granular permission schemes / more roles | PM/Dev only; matrix partial |
| G-22 | REST API for integrations (tokens) + webhooks | Cookie-session APIs only |
| G-23 | CSV import/export | None |
| G-24 | Global audit log | Per-item event log only |
| G-25 | Project templates | None |
| G-26 | Archiving (items/projects) | Tombstones for WIs only |
| G-27 | AI features (summaries, risk identification, auto-assignment) | None |
| G-28 | SSO / SAML | Email+password only |
| G-29 | Marketplace / 3,000+ integrations, Slack/Gmail/Figma embeds, mobile apps | Out of scope (see Non-goals) |

## 3. Implementation plan

Principles (carry forward from phases 1–6):
- Lifecycle/behaviour changes go through the **event log + declarative tables**, never code branches.
- Metadata (fields, labels, versions, goals) is **columns/tables, not events**, mirroring the item→project precedent.
- MariaDB only; SQL in `src/server/repo/`; writes via commands or PM-guarded admin routes; `expectedVersion` optimistic concurrency everywhere events are appended.
- Each phase: migration → repo → engine (if lifecycle) → API route → UI → vitest + Playwright.

### Phase 7 — Finish phase 6 + collaboration plumbing (G-19, item links UI, G-21 completion)
1. Item-links UI (engine already emits `WI_LINK`-style events for items): link picker in drawer, inverse-link display, dangling-link drop already handled at derive time.
2. Wire @mentions end-to-end: parse `@name` in item/WI comment commands server-side, insert `notifications` rows (kind `mention`), highlight in comment render.
3. Complete permissions matrix: finish server enforcement for every route, add `Admin` role (third role) for org/team CRUD so PM stops doubling as admin.

### Phase 8 — Fields & metadata parity (G-5..G-9)
1. **Custom fields**: `field_defs` (project_id nullable=global, key, name, kind: text/number/date/select/multi/user, options JSON) + values carried in WI patch events as `customFields` map on `WiPatchWire` (clears as `null`). Render dynamically in WI drawer; board filters pick them up.
2. **Subtasks**: `parent_wi_id` on work items via WI events; rollup — parent can't be `done` with open subtasks (same pattern as `wiBlockedBy`).
3. **Labels & components**: promote `tags` to managed `labels` table (autocomplete, rename cascades at read time); add `components` table per project + WI field.
4. **Attachments**: `attachments` table (item_id/wi_id, filename, mime, size, blob path), local disk storage under `var/uploads/` behind a route handler with auth + size/mime validation; chip list in drawers.
5. **Time tracking**: `originalEstimate`/`remainingEstimate` WI fields + `WORKLOG_ADD` events (author, seconds, note, at); remaining auto-decrements; per-sprint logged-time rollup in TeamSpace.

### Phase 9 — Views (G-1..G-4)
1. **List view**: virtualized table of WIs across visible projects; inline edit (state, assignee, sprint, points) via existing commands; column chooser incl. custom fields; CSV export hook (feeds G-23).
2. **Timeline (Gantt)**: items as bars (planned enter/exit dates already exist on phases — reuse plan-vs-actual data), WIs grouped under items; dependency arrows from `blocks` links; drag to adjust planned dates (`PLAN_SET` event, already modeled).
3. **Calendar view**: month grid plotting sprint boundaries, planned phase exits, and WIs by due date (new optional `dueDate` WI field, added in phase 8 migration).
4. **Project summary view**: per-project landing — lane spread, gate status of in-flight items, sprint snapshot, recent activity.

### Phase 10 — Query language & filters (G-11)
1. **CQL** (Cadence Query Language, JQL subset): grammar `field op value [AND|OR ...] [ORDER BY field]`; ops `= != ~ in > <`; fields: project, type, state, assignee, sprint, label, points, priority, custom fields. Pure parser + evaluator in `src/lib/cql.ts` (pure, testable like engine).
2. Server: `/api/search?cql=` evaluates against derived snapshots (paginate, cap).
3. **Saved filters**: `filters` table (owner, name, cql, shared bool); board/list/timeline accept a saved filter; **quick filters** = per-board pinned filters.

### Phase 11 — Dashboards & reports (G-12, G-17, G-24)
1. **Gadget framework**: `dashboards` + `dashboard_gadgets` (kind, config JSON incl. CQL + project scope, position). Gadgets: lane spread, CFD, burndown, velocity, created-vs-resolved, my work, filter results, at-risk. Grid layout, add/remove/reorder; default dashboard reproduces today's `DashboardView`.
2. **New reports** (all pure folds in `reports.ts`): burnup (scope line + done line), sprint report (committed vs completed vs spilled per sprint), control chart (cycle time per WI from existing `timeInState` fold, scatter + rolling mean), created-vs-resolved, epic/version progress.
3. **Global audit log**: read-side endpoint unioning event tables across items (paginated, filterable by actor/kind/project) + admin UI.

### Phase 12 — Releases (G-10)
1. `versions` table per project (name, start, release date, state: unreleased/released/archived) + `fixVersion` WI/item field (column, not event — metadata like project_id).
2. **Release hub**: per-version progress (done/in-progress/todo counts, blocking gate conditions of member items), release button — guarded: every member item must be ≥ `released` on the spine, otherwise typed rejection listing stragglers. Ties Jira's release concept to Cadence's release gate instead of bypassing it.

### Phase 13 — Automation engine (G-14, G-20)
Event sourcing makes this cheap: rules subscribe to the same event stream commands already append to.
1. `automation_rules` (project scope, trigger kind, condition JSON = CQL fragment, actions JSON, enabled) + `automation_runs` audit table.
2. Triggers: event appended (by kind), state entered, sprint started/closed, schedule (cron via existing job runner or `setInterval` in a route-handler-driven tick). Actions: transition WI/item (through `applyTransition` — rules can't bypass gates), set field, add comment, notify, create WI.
3. Executor runs server-side post-command in same request (sync, depth-capped at 3 to stop loops) — events appended by rules carry `actor: "automation"`.
4. **Email notifications**: notification fan-out gains channel column; SMTP sender (nodemailer) behind env flag; per-user notification preferences table (Jira "notification scheme" equivalent, simplified).
5. Rule builder UI: trigger → condition (CQL) → actions list.

### Phase 14 — Workflow customization (G-13, G-25)
1. Move `TRANSITIONS`/`GATES`/`WI_FLOW_OVERRIDES` defaults into DB (`workflow_schemes`, rows mirror the table literals); engine functions take the scheme as a parameter (already pure — thread it through `deriveItem`/`applyTransition` call sites); per-project scheme assignment.
2. **Workflow editor** (admin UI): graph view of states/transitions, edit roles/gate/needsReason per transition, add/remove transitions; validation = engine invariants (spine reachability, gate placement on forward transitions only).
3. **Project templates**: snapshot of workflow scheme + field defs + components + board config; `POST /api/projects` accepts `templateId`; ship "Cadence PDLC" (today's behaviour) and "Simple Kanban" templates.

### Phase 15 — Intake, goals, planning (G-15, G-16, G-18)
1. **Forms**: `forms` table (project, field list referencing field_defs, public token); public submit route creates a WI in intake state (`todo`, label `intake`) — rate-limited, validated.
2. **Goals**: `goals` table (org scope, title, target date, status) + `item_goals` M:N; goal progress = fold over member items' spine positions; goals lens on dashboard + timeline.
3. **Plans-lite (cross-team)**: multi-project timeline with capacity row per team (sum committed points vs velocity avg), cross-project dependency arrows, what-if sandbox = client-side only (re-derive with hypothetical plan dates, never persisted — matches engine's pure-fold design).

### Phase 16 — Platform & enterprise (G-22, G-23, G-26, G-27, G-28)
1. **API tokens**: `api_tokens` table (hashed, scoped read/write); bearer auth alongside cookie sessions; document existing routes as the public REST API.
2. **Webhooks**: `webhooks` table (url, event-kind filter, secret); fire-and-forget POST with HMAC signature post-commit; retries with backoff, dead-letter flag.
3. **CSV import/export**: export from list view (current columns/filter); import maps columns → fields, creates WIs via commands (so flows/guards still apply); dry-run preview.
4. **Archiving**: `archived_at` on items/projects; archived excluded from boards/search by default, visible via CQL `archived = true`.
5. **SSO**: OIDC (covers Google/Okta; SAML only if a concrete IdP demands it) via openid-client; map to existing `users` rows by email; keep password auth as fallback.
6. **AI (optional, last)**: Claude API — sprint-report narrative, comment-thread summary, risk flagging (suggest shift-left flags from item description), auto-assignment suggestion. Server-side only, suggestions never auto-applied; humans confirm via normal commands.

## 4. Non-goals
- Marketplace / 3,000+ third-party integrations, Slack/Gmail/Figma embedded experiences, native mobile apps, data residency controls — platform-scale features, not single-app parity.
- Replicating Jira's UI; Cadence keeps the prototype design system (`app/globals.css`).

## 5. Sequencing & risk
- Order is dependency-driven: fields (8) before views/CQL (9–10) because list/timeline/CQL must handle custom fields; CQL (10) before dashboards/automation (11, 13) because both consume it as their condition language; workflow-in-DB (14) is the riskiest engine change — isolated late, behind a default scheme equal to today's literals so behaviour is unchanged until a project opts out.
- Every phase lands behind the existing test gates: engine changes get pure vitest folds; routes get integration tests (self-skip without `DATABASE_ADMIN_URL`); each new view gets one Playwright happy-path spec.
