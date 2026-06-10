# Phase 2 — Project/Team Hierarchy + Scrum Team Space — Design Spec

**Date:** 2026-06-10
**Branch:** feat/phase1-backend
**Status:** Implementing
**Depends on:** Phase 1 (MariaDB persistence, auth, command layer)

## Goal

Replace the static org → group → team sidebar fixture with a real, DB-backed,
**project-based** hierarchy:

- A **project** owns items (features/epics). `items.project_id`.
- A project can be **owned by multiple teams** (`project_teams`, M:N).
- A **team** includes multiple users (`team_members`, M:N).
- Each team gets a **scrum-based team space**: sprint board, backlog, sprint stats.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | Read-side hierarchy (schema + seed + structure API + UI). Admin CRUD for projects/teams is Phase 3 |
| 2 | Engine impact | `Item.project?: string \| null` only — the engine never branches on it |
| 3 | API | One `GET /api/structure` returning projects + teams + memberships in a single payload |
| 4 | Spawned children | inherit the parent's `project_id` |
| 5 | Sprint model | unchanged (free-text `wi.sprint`); team space derives the sprint list from its items' work items |
| 6 | Scrum template | team space = members header + owned projects + sprint picker + sprint board (WI-state columns) + ranked backlog (no-sprint WIs) + committed/done points |
| 7 | `area` field | kept as a display label on items; no longer drives grouping |

## Schema (migrations/0002_projects_teams.sql)

```sql
projects      (id VARCHAR(36) PK, `key` VARCHAR(16) UNIQUE, name, description, created_at)
teams         (id VARCHAR(36) PK, name VARCHAR(128) UNIQUE, created_at)
project_teams (project_id FK, team_id FK, PK(project_id, team_id))
team_members  (team_id FK, user_id FK, PK(team_id, user_id))
items         + project_id VARCHAR(36) NULL FK → projects(id)
```

## Seed

- 4 projects: Commerce Platform (PAY, BILLING) · Identity & Access (AUTH) ·
  Discovery & Growth (SEARCH, NOTIF) · Onboarding Experience (ONB)
- 4 teams: Checkout Crew · Identity Core · Growth Guild · Platform Foundation
- Multi-team ownership demo: Commerce ← {Checkout Crew, Platform Foundation};
  Identity ← {Identity Core, Platform Foundation}
- 4 users (2 new): priya@cadence.dev (Dev), lena@cadence.dev (PM); memberships spread

## API

`GET /api/structure` (authed) →
```ts
{ projects: { id, key, name, description, teamIds: string[], }[],
  teams:    { id, name, members: { id, name, role }[], projectIds: string[] }[] }
```

## UI

- **Navigator**: PROJECTS section (project → epic→feature tree from `item.project`),
  TEAMS section (click → team space view). Org popover dropped.
- **Team space** (`view === "team"`): scrum template per Decision 6, reusing the
  flow-checked `wiMove` command path for board drags.

## Out of scope

Project/team admin UI, per-team permissions, sprint entities with start/end dates,
cross-team capacity planning.
