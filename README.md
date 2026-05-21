# project-management

A Jira-like project management application built with Next.js, Prisma, and Auth.js.

## Prerequisites

- **Node.js 22+**
- **pnpm 10+** (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker** (for local Postgres, Mailpit, MinIO and for the integration test tier)

## Quickstart

```bash
# 1. Bring up local infra (Postgres, Mailpit, MinIO)
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Copy env template and adjust if needed
cp .env.example .env

# 4. Apply database migrations
pnpm db:migrate

# 5. Start the dev server
pnpm dev
```

The app boots at <http://localhost:3000>. A health probe lives at `/api/health`.

Supporting UIs:

- Mailpit (dev mail catcher): <http://localhost:8025>
- MinIO console: <http://localhost:9001> (user/pass `minioadmin` / `minioadmin`)

## Scripts

| Script            | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `pnpm dev`        | Start Next.js in development mode                       |
| `pnpm build`      | Production build                                        |
| `pnpm start`      | Run the production build                                |
| `pnpm lint`       | ESLint (`next/core-web-vitals`)                         |
| `pnpm typecheck`  | `tsc --noEmit` against the strict config                |
| `pnpm test`       | Vitest unit tests (`tests/unit/**`, `src/**/*.test.ts`) |
| `pnpm test:int`   | Vitest integration tests against ephemeral Postgres     |
| `pnpm test:e2e`   | Playwright end-to-end tests                             |
| `pnpm db:migrate` | Prisma `migrate dev` against the running Postgres       |
| `pnpm db:seed`    | Run the seed script (`prisma/seed.ts`)                  |
| `pnpm format`     | Prettier write across the repo                          |

## Test pyramid

Tests live under `/tests` and are organised into three tiers — broad and cheap at
the bottom, narrow and expensive at the top:

1. **Unit** (`tests/unit/`) — fast, isolated. Jsdom environment. Domain services
   and pure logic. Run continuously during development with `pnpm test`.
2. **Integration** (`tests/integration/`) — real Postgres via
   `@testcontainers/postgresql`. Exercise route handlers, services, and Prisma
   together. Slower; gated by `DOCKER_AVAILABLE=1` so local runs without Docker
   still pass cleanly. CI sets the flag and runs them every push.
3. **End-to-end** (`tests/e2e/`) — Playwright. Boot the real Next.js server and
   drive it through Chromium. One golden-path scenario per slice.

Factories used by tests live in `tests/factories/*.ts` — reuse them rather than
inlining fixtures.

## Further reading

- [`FEATURES.md`](./FEATURES.md) — the product feature catalogue.
- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — phased plan, TDD
  methodology, and progress tracker.
