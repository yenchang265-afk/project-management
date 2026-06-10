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

## Run

```bash
npm install
npm run dev    # http://localhost:3000
```

## Verify

```bash
npm test       # engine unit tests (vitest)
npm run build  # production build
```

## Structure

- `src/lib/engine.ts` — pure event-sourced state machine (no React/DOM)
- `src/lib/seed.ts` — seed items as event logs
- `src/components/` — UI components (port of the prototype, CSS verbatim in `app/globals.css`)
- `app/` — Next.js App Router entry
