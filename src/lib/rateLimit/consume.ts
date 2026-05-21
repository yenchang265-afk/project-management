// In-Postgres token-bucket rate limiter — persistence layer.
//
// `consume()` is wrapped in a single transaction with SELECT ... FOR UPDATE
// so concurrent requests for the same bucket key serialize at the row level
// instead of racing. Prisma doesn't expose row-level locks through the
// generated client, so we use $queryRaw + $executeRaw inside an interactive
// transaction.

import type { PrismaClient } from '@prisma/client';

import { consumePure, type Limit } from './tokenBucket';

export type ConsumeOk = { allowed: true; remaining: number };
export type ConsumeDenied = { allowed: false; remaining: number; retryAfterMs: number };
export type ConsumeOutcome = ConsumeOk | ConsumeDenied;

type Row = { key: string; tokens: number; lastRefill: Date };

export async function consume(
  prisma: PrismaClient,
  key: string,
  limit: Limit,
): Promise<ConsumeOutcome> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();

    // SELECT FOR UPDATE — locks the row if it exists. If it doesn't exist
    // yet, Postgres has nothing to lock; we INSERT a fresh full bucket and
    // immediately re-read inside the same tx so a concurrent inserter loses
    // the unique-key race instead of double-consuming.
    const rows = await tx.$queryRaw<Row[]>`
      SELECT "key", "tokens", "lastRefill"
      FROM "RateLimitBucket"
      WHERE "key" = ${key}
      FOR UPDATE
    `;

    let state: { tokens: number; lastRefill: Date };
    if (rows.length === 0) {
      // First request for this key — start the bucket at full capacity.
      // ON CONFLICT DO NOTHING so a concurrent inserter wins gracefully;
      // we then re-SELECT FOR UPDATE to settle on a single locked row.
      await tx.$executeRaw`
        INSERT INTO "RateLimitBucket" ("key", "tokens", "lastRefill")
        VALUES (${key}, ${limit.capacity}, ${now})
        ON CONFLICT ("key") DO NOTHING
      `;
      const after = await tx.$queryRaw<Row[]>`
        SELECT "key", "tokens", "lastRefill"
        FROM "RateLimitBucket"
        WHERE "key" = ${key}
        FOR UPDATE
      `;
      const row = after[0];
      if (!row) {
        // Should be impossible (we just inserted under a lock) but bail out
        // open rather than throw — denying every request on a transient DB
        // glitch would be worse than letting one through.
        return { allowed: true, remaining: limit.capacity - (limit.cost ?? 1) };
      }
      state = { tokens: row.tokens, lastRefill: row.lastRefill };
    } else {
      const row = rows[0]!;
      state = { tokens: row.tokens, lastRefill: row.lastRefill };
    }

    const result = consumePure(state, now, limit);

    await tx.$executeRaw`
      UPDATE "RateLimitBucket"
      SET "tokens" = ${result.tokens}, "lastRefill" = ${result.lastRefill}
      WHERE "key" = ${key}
    `;

    if (result.allowed) {
      return { allowed: true, remaining: result.remaining };
    }
    return {
      allowed: false,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs ?? 1000,
    };
  });
}
