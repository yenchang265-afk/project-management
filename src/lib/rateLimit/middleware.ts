// Rate-limit middleware for Next.js route handlers.
//
// Usage:
//   export const POST = withRateLimit(
//     { keyFn: authIpKey, limit: AUTH_LIMIT },
//     handler,
//   );
//
// On denial we return 429 with a Retry-After header. The middleware never
// mutates the underlying handler — it just gates the call.

import { prisma } from '@/server/db';

import { consume } from './consume';
import { tooManyRequests } from '@/lib/http';
import type { Limit } from './tokenBucket';

export type RateLimitContext = { req: Request; params?: Record<string, unknown> };

export type RateLimitOptions = {
  keyFn: (ctx: RateLimitContext) => Promise<string> | string;
  limit: Limit;
  // Allow tests to inject a fake prisma without spinning up Postgres.
  consumer?: typeof consume;
};

// Route handlers come in two shapes:
//   - root routes (no dynamic segments) take `(req)`
//   - parametrised routes take `(req, ctx)` where ctx = { params }
// We expose two overloads of withRateLimit so each caller's signature is
// preserved end-to-end. Integration tests that call `POST(req)` directly
// against a root route still typecheck.
type Handler0 = (req: Request) => Promise<Response>;
type Handler1<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

export function withRateLimit(opts: RateLimitOptions, handler: Handler0): Handler0;
export function withRateLimit<Ctx>(opts: RateLimitOptions, handler: Handler1<Ctx>): Handler1<Ctx>;
export function withRateLimit<Ctx>(
  opts: RateLimitOptions,
  handler: Handler0 | Handler1<Ctx>,
): Handler0 | Handler1<Ctx> {
  const consumer = opts.consumer ?? consume;
  return async (req: Request, ctx?: Ctx): Promise<Response> => {
    // Allow a per-process opt-out (used by integration tests, which would
    // otherwise interfere across cases and require maintaining a separate
    // RateLimitBucket fixture). Unit tests for THIS middleware deliberately
    // leave the flag unset.
    if (process.env.DISABLE_RATE_LIMIT === '1') {
      return (handler as Handler1<Ctx>)(req, ctx as Ctx);
    }
    // We don't unwrap params here — passing a Promise through to keyFn would
    // be awkward and most keys only need the request. If a future key
    // requires a route param, keyFn can `await ctx?.params`.
    let key: string;
    try {
      key = await opts.keyFn({ req });
    } catch {
      // If we can't compute a key, fail open rather than block all traffic.
      return (handler as Handler1<Ctx>)(req, ctx as Ctx);
    }
    let outcome;
    try {
      outcome = await consumer(prisma, key, opts.limit);
    } catch {
      // Persistence failure: fail open. A broken bucket store must not 500
      // the entire endpoint.
      return (handler as Handler1<Ctx>)(req, ctx as Ctx);
    }
    if (!outcome.allowed) {
      return tooManyRequests({
        retryAfterSec: Math.max(1, Math.ceil(outcome.retryAfterMs / 1000)),
        message: 'Rate limit exceeded',
      });
    }
    return (handler as Handler1<Ctx>)(req, ctx as Ctx);
  };
}

// -- key helpers ---------------------------------------------------------

// Heuristic: read the leftmost address in X-Forwarded-For (Vercel/Cloud
// providers set this). Falls back to a stable string so unauthenticated
// dev requests still get bucketed.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

export const authIpKey = (ctx: RateLimitContext): string => `auth:ip:${clientIp(ctx.req)}`;

// userId-aware write key. If we can't determine the user, fall back to IP so
// a single anonymous client can't blow through write limits.
export async function writeUserKey(ctx: RateLimitContext): Promise<string> {
  // Avoid eager auth() import at module load to keep this helper test-friendly.
  const { auth } = await import('@/server/auth');
  const session = await auth();
  const userId = session?.user?.id;
  if (userId) return `write:user:${userId}`;
  return `write:ip:${clientIp(ctx.req)}`;
}

// -- canonical limits ---------------------------------------------------

export const AUTH_LIMIT: Limit = { capacity: 10, refillPerSec: 10 / 60 };
export const WRITE_LIMIT: Limit = { capacity: 60, refillPerSec: 60 / 60 };
