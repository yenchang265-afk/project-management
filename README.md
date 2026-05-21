# Project Management

A Jira-like project management tool built with Next.js 15, TypeScript, Prisma, and Auth.js.

## Dev setup

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm install

# 3. Set environment variables
cp .env.example .env
# Edit .env with your values

# 4. Run migrations
npm run db:migrate

# 5. Seed the database
npm run db:seed

# 6. Start the dev server
npm run dev
```

## Scripts

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `npm run dev`        | Start dev server                       |
| `npm run build`      | Build for production                   |
| `npm run start`      | Start production server                |
| `npm test`           | Run unit tests                         |
| `npm run test:int`   | Run integration tests (needs Postgres) |
| `npm run test:e2e`   | Run Playwright E2E tests               |
| `npm run test:all`   | Run all test tiers                     |
| `npm run lint`       | Lint the codebase                      |
| `npm run typecheck`  | TypeScript type check                  |
| `npm run format`     | Format with Prettier                   |
| `npm run db:migrate` | Apply migrations                       |
| `npm run db:seed`    | Seed the database                      |
| `npm run db:studio`  | Open Prisma Studio                     |

## Architecture

See [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the full feature roadmap and implementation phases.

```
/app                  Next.js App Router routes
/src
  /server
    /db               Prisma client
    /auth             Auth.js config
    /services         Domain services (Phase 1+)
  /lib                Shared utilities (Zod schemas, error types, env)
  /ui                 Reusable UI components (Phase 1+)
/prisma               Schema and migrations
/tests
  /unit               Unit tests (Vitest)
  /integration        Integration tests (Vitest + real Postgres)
  /e2e                Playwright specs
```
