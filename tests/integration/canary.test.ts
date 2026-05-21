import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('canary (integration) — Postgres via Testcontainers', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();
    const url = container.getConnectionUri();
    process.env.DATABASE_URL = url;

    // Apply migrations against the ephemeral DB so the schema is real.
    execSync('pnpm prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    client = new Client({ connectionString: url });
    await client.connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('SELECT 1 round-trips', async () => {
    const result = await client.query('SELECT 1 AS one');
    expect(result.rows[0]?.one).toBe(1);
  });

  it('Prisma migrations created the User table', async () => {
    const result = await client.query('SELECT to_regclass(\'public."User"\') AS exists');
    expect(result.rows[0]?.exists).toBe('"User"');
  });
});
