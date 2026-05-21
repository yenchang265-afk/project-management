# Operations Runbook

Day-2 operations for the project-management app. Owners: backend on-call.

## Backups

### Taking a backup

The repo ships a cron-friendly script:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/app ./scripts/backup.sh
```

It runs `pg_dump | gzip` and writes to `./backups/$(date -u +"%Y-%m-%dT%H-%M").sql.gz`. Override the destination with `BACKUP_DIR=/srv/backups`.

Suggested cron (nightly at 02:00 UTC, retain 30 days):

```cron
0 2 * * *  cd /srv/app && DATABASE_URL=$(cat /etc/app/database_url) ./scripts/backup.sh
0 3 * * *  find /srv/app/backups -name "*.sql.gz" -mtime +30 -delete
```

### Restoring a backup

```bash
gunzip -c backups/2026-05-21T02-00.sql.gz | psql "$DATABASE_URL"
```

For a clean restore, drop the schema first:

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c backups/2026-05-21T02-00.sql.gz | psql "$DATABASE_URL"
```

After a restore, regenerate Prisma client metadata in the running process or restart the app.

## Migrations

### Applying

```bash
pnpm prisma migrate deploy
```

Idempotent. CI runs this before tests.

### Rolling back

Prisma does not generate down-migrations. The supported rollback strategy is:

1. Restore the most recent backup taken **before** the bad migration ran.
2. Branch the migration out of the `prisma/migrations/` history by reverting the commit that added it.
3. Re-run `pnpm prisma migrate deploy` (which now sees nothing to apply).

For fast-forward fixes (forgot a NOT NULL, wrong default) prefer a new follow-up migration over a destructive rollback.

## Rate-limit buckets

The `RateLimitBucket` table holds one row per (bucket key). Keys look like:

- `auth:ip:<addr>` — `/api/auth/*` endpoints, 10/min/IP
- `write:user:<id>` — POST/PATCH/DELETE under `/api/issues|projects|sprints`, 60/min/user
- `write:ip:<addr>` — same as above but for unauthenticated callers

### Inspecting current state

```sql
-- Top 20 hottest buckets right now
SELECT key, tokens, "lastRefill"
FROM "RateLimitBucket"
ORDER BY tokens ASC
LIMIT 20;
```

### Manually clearing a bucket

```sql
DELETE FROM "RateLimitBucket" WHERE key = 'auth:ip:1.2.3.4';
```

The service re-creates the row at full capacity on the next request.

### Garbage collection

Stale rows are harmless (they just sit there). Periodically prune buckets idle for more than a day:

```sql
DELETE FROM "RateLimitBucket"
WHERE "lastRefill" < now() - interval '1 day';
```

## OpenAPI

The contract under `docs/openapi.json` is generated from Zod schemas registered in `src/lib/openapi/routes.ts`. Regenerate it after any registration change:

```bash
pnpm openapi
```

CI runs the same command and fails the build if the committed doc is out of date (`git diff --exit-code docs/openapi.json`). The endpoint `GET /api/openapi.json` serves the doc at runtime; in dev it rebuilds on the fly so you don't need to re-run the script while iterating.

## Logs

- **Dev**: `pnpm dev` streams Next.js + service logs to stdout. Domain-event subscribers also log via `console.log` (`[event] foo.bar { ... }`).
- **CI**: GitHub Actions step output is the canonical log; download the run artifact for full output.
- **Production**: redirect stdout to your log shipper (Vector, Promtail, etc.). The app does not write to disk.

Tail in dev:

```bash
pnpm dev | tee /tmp/app.log
# in another shell:
tail -F /tmp/app.log
```

## Health check

`GET /api/health` returns 200 OK once the DB is reachable. Use as a load-balancer probe.
