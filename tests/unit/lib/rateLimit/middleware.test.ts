// withRateLimit unit specs.
//
// We inject a fake `consumer` so these tests don't touch Postgres. The fake
// returns whatever the test setup configured for the key, and we assert the
// middleware:
//   - passes through to the wrapped handler when allowed
//   - returns 429 + Retry-After when denied
//   - uses the keyFn output to look up the bucket
//   - falls open if the keyFn throws

import { describe, expect, it, vi } from 'vitest';

import {
  AUTH_LIMIT,
  WRITE_LIMIT,
  authIpKey,
  clientIp,
  withRateLimit,
} from '@/lib/rateLimit/middleware';

function mkReq(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { method: 'POST', headers });
}

describe('withRateLimit()', () => {
  it('invokes the handler when the consumer allows', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }));
    const consumer = vi.fn(async () => ({ allowed: true as const, remaining: 9 }));
    const wrapped = withRateLimit(
      { keyFn: () => 'fixed-key', limit: WRITE_LIMIT, consumer },
      handler,
    );
    const res = await wrapped(mkReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(consumer).toHaveBeenCalledWith(expect.anything(), 'fixed-key', WRITE_LIMIT);
  });

  it('returns 429 with Retry-After when denied', async () => {
    const handler = vi.fn();
    const consumer = vi.fn(async () => ({
      allowed: false as const,
      remaining: 0,
      retryAfterMs: 2500,
    }));
    const wrapped = withRateLimit({ keyFn: () => 'k', limit: AUTH_LIMIT, consumer }, handler);
    const res = await wrapped(mkReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3'); // ceil(2.5)
    expect(handler).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('falls open if the keyFn throws', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }));
    const consumer = vi.fn();
    const wrapped = withRateLimit(
      {
        keyFn: () => {
          throw new Error('boom');
        },
        limit: WRITE_LIMIT,
        consumer,
      },
      handler,
    );
    const res = await wrapped(mkReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(consumer).not.toHaveBeenCalled();
  });
});

describe('key helpers', () => {
  it('clientIp() reads x-forwarded-for (leftmost)', () => {
    expect(clientIp(mkReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('clientIp() falls back to x-real-ip', () => {
    expect(clientIp(mkReq({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('clientIp() returns "unknown" when no headers', () => {
    expect(clientIp(mkReq())).toBe('unknown');
  });

  it('authIpKey() namespaces by ip', () => {
    expect(authIpKey({ req: mkReq({ 'x-forwarded-for': '1.1.1.1' }) })).toBe('auth:ip:1.1.1.1');
  });
});
