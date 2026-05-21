// Pure token-bucket math used by the in-Postgres rate limiter.
//
// We keep this off the DB so the algorithm is exhaustively unit-tested and
// the persistence layer (consume.ts) is reduced to "SELECT FOR UPDATE,
// apply consumePure, UPDATE". No external services (Upstash etc.) — Phase 5b
// explicitly prefers an in-Postgres approach.

export type BucketState = {
  tokens: number;
  lastRefill: Date;
};

export type Limit = {
  capacity: number;
  refillPerSec: number;
  cost?: number;
};

export function refill(
  bucket: BucketState,
  now: Date,
  args: { capacity: number; refillPerSec: number },
): BucketState {
  const elapsedMs = Math.max(0, now.getTime() - bucket.lastRefill.getTime());
  const tokens = Math.min(args.capacity, bucket.tokens + (elapsedMs / 1000) * args.refillPerSec);
  return { tokens, lastRefill: now };
}

export type ConsumeResult = BucketState & {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
};

export function consumePure(bucket: BucketState, now: Date, limit: Limit): ConsumeResult {
  const cost = limit.cost ?? 1;
  const refilled = refill(bucket, now, limit);
  if (refilled.tokens >= cost) {
    const tokens = refilled.tokens - cost;
    return {
      tokens,
      lastRefill: refilled.lastRefill,
      allowed: true,
      remaining: Math.floor(tokens),
    };
  }
  const deficit = cost - refilled.tokens;
  const retryAfterMs = Math.ceil((deficit / limit.refillPerSec) * 1000);
  return {
    tokens: refilled.tokens,
    lastRefill: refilled.lastRefill,
    allowed: false,
    remaining: Math.floor(refilled.tokens),
    retryAfterMs,
  };
}
