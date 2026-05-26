// Token-bucket math for the in-Postgres rate limiter.
//
// The pure function `refill(bucket, now, capacity, refillPerSec)` is what
// the SQL transaction runs against the row fetched FOR UPDATE. We isolate
// it here so the math is exhaustively covered without touching the DB.
// `consumePure` decides whether the bucket can afford `cost` tokens and
// returns the post-state plus a retryAfterMs hint when denied.

import { describe, expect, it } from 'vitest';

import { consumePure, refill } from '@/lib/rateLimit/tokenBucket';

describe('refill()', () => {
  it('adds refillPerSec * elapsed tokens, clamped at capacity', () => {
    const now = new Date('2026-05-21T00:00:10.000Z');
    const out = refill({ tokens: 0, lastRefill: new Date('2026-05-21T00:00:00.000Z') }, now, {
      capacity: 10,
      refillPerSec: 1,
    });
    expect(out.tokens).toBe(10);
    expect(out.lastRefill).toEqual(now);
  });

  it('does not exceed capacity even after a long idle period', () => {
    const now = new Date('2026-05-21T01:00:00.000Z');
    const out = refill({ tokens: 5, lastRefill: new Date('2026-05-21T00:00:00.000Z') }, now, {
      capacity: 10,
      refillPerSec: 1,
    });
    expect(out.tokens).toBe(10);
  });

  it('handles clock skew (now < lastRefill) by clamping elapsed to 0', () => {
    const now = new Date('2026-05-21T00:00:00.000Z');
    const out = refill({ tokens: 3, lastRefill: new Date('2026-05-21T00:00:05.000Z') }, now, {
      capacity: 10,
      refillPerSec: 1,
    });
    expect(out.tokens).toBe(3);
  });
});

describe('consumePure()', () => {
  const limit = { capacity: 10, refillPerSec: 1, cost: 1 };

  it('allows a single request when tokens >= cost and decrements', () => {
    const now = new Date('2026-05-21T00:00:00.000Z');
    const out = consumePure({ tokens: 5, lastRefill: now }, now, limit);
    expect(out.allowed).toBe(true);
    expect(out.tokens).toBe(4);
    expect(out.remaining).toBe(4);
    expect(out.retryAfterMs).toBeUndefined();
  });

  it('denies when tokens < cost and reports retryAfterMs based on refill rate', () => {
    const now = new Date('2026-05-21T00:00:00.000Z');
    const out = consumePure({ tokens: 0, lastRefill: now }, now, {
      capacity: 10,
      refillPerSec: 2,
      cost: 1,
    });
    expect(out.allowed).toBe(false);
    expect(out.tokens).toBe(0);
    expect(out.remaining).toBe(0);
    // refillPerSec=2 => 1 token in 500ms => retry-after ≈ 500
    expect(out.retryAfterMs).toBe(500);
  });

  it('refills on the fly before deciding', () => {
    const start = new Date('2026-05-21T00:00:00.000Z');
    const now = new Date('2026-05-21T00:00:03.000Z');
    const out = consumePure({ tokens: 0, lastRefill: start }, now, limit);
    // 3s of refill at 1/s => 3 tokens, consume 1 => 2 remaining
    expect(out.allowed).toBe(true);
    expect(out.tokens).toBe(2);
  });

  it('denies a cost larger than capacity instantly', () => {
    const now = new Date('2026-05-21T00:00:00.000Z');
    const out = consumePure({ tokens: 10, lastRefill: now }, now, {
      capacity: 10,
      refillPerSec: 1,
      cost: 100,
    });
    expect(out.allowed).toBe(false);
    // 90 tokens to refill at 1/s => 90_000 ms
    expect(out.retryAfterMs).toBe(90_000);
  });
});
