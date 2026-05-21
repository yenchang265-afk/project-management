// Integration test for the in-Postgres token-bucket limiter.
//
// We boot a real Postgres, apply migrations, then bombard `consume()` for a
// single key until it returns `allowed: false`. The assertion is "after N
// successes the (N+1)th call is denied with a non-trivial retryAfterMs" —
// the exact N matches the bucket capacity.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('rateLimit.consume() against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();
    const databaseUrl = container.getConnectionUri();
    process.env.DATABASE_URL = databaseUrl;
    execSync('pnpm prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('allows up to capacity, then 429s with retryAfterMs', async () => {
    const { consume } = await import('@/lib/rateLimit/consume');
    const key = 'test:bomb:' + Date.now();
    const limit = { capacity: 3, refillPerSec: 1, cost: 1 };

    const outcomes: Array<Awaited<ReturnType<typeof consume>>> = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await consume(prisma, key, limit));
    }

    // First 3 succeed (capacity), last 2 fail (refilled fraction insufficient
    // since calls happen in microseconds).
    expect(outcomes.slice(0, 3).every((o) => o.allowed)).toBe(true);
    expect(outcomes[3]!.allowed).toBe(false);
    expect(outcomes[4]!.allowed).toBe(false);
    if (!outcomes[3]!.allowed) {
      expect(outcomes[3]!.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('refills tokens over wall-clock time', async () => {
    const { consume } = await import('@/lib/rateLimit/consume');
    const key = 'test:refill:' + Date.now();
    const limit = { capacity: 1, refillPerSec: 10, cost: 1 };

    // Drain the bucket.
    expect((await consume(prisma, key, limit)).allowed).toBe(true);
    expect((await consume(prisma, key, limit)).allowed).toBe(false);
    // Wait long enough for at least one token to refill.
    await new Promise((r) => setTimeout(r, 200));
    expect((await consume(prisma, key, limit)).allowed).toBe(true);
  });
});
