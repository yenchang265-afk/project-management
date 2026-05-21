// HTTP response helpers used across route handlers. Standardizes:
//   - success envelopes (raw payload or { data, pageInfo })
//   - error envelope: { error: { code, message, details? } }
// Phase 5b will reuse these (and add rate-limit headers) — keep the shape
// stable.

import { NextResponse } from 'next/server';

import { AuthError } from './errors';

export type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(body: T): NextResponse<T> {
  return NextResponse.json(body, { status: 200 });
}

export function created<T>(body: T): NextResponse<T> {
  return NextResponse.json(body, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

// Standard list envelope used by every Phase 5b paginated endpoint.
//   { data: T[], pageInfo: { nextCursor, hasMore } }
// Centralizing the shape here keeps clients and the OpenAPI doc in sync.
export type ListBody<T> = {
  data: T[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
};

export function list<T>(args: {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}): NextResponse<ListBody<T>> {
  return NextResponse.json(
    { data: args.data, pageInfo: { nextCursor: args.nextCursor, hasMore: args.hasMore } },
    { status: 200 },
  );
}

// Generic error envelope. Phase 5b prefers callers use this directly so the
// `code` is intentional rather than derived from an exception class. The
// existing badRequest/notFound/... helpers stay for backward compatibility.
export function error(opts: {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}): NextResponse<ErrorBody> {
  const body: ErrorBody = { error: { code: opts.code, message: opts.message } };
  if (opts.details !== undefined) body.error.details = opts.details;
  return NextResponse.json(body, { status: opts.status });
}

// 429 Too Many Requests with a Retry-After header. Used by the rate-limit
// middleware (src/lib/rateLimit) but kept here so route handlers can build
// the response directly if they need bespoke logic.
export function tooManyRequests(opts: {
  retryAfterSec: number;
  message?: string;
  details?: unknown;
}): NextResponse<ErrorBody> {
  const body: ErrorBody = {
    error: { code: 'rate_limited', message: opts.message ?? 'Too many requests' },
  };
  if (opts.details !== undefined) body.error.details = opts.details;
  return NextResponse.json(body, {
    status: 429,
    headers: { 'Retry-After': String(Math.max(0, Math.ceil(opts.retryAfterSec))) },
  });
}

function err(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ErrorBody> {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export const badRequest = (msg = 'Bad request', details?: unknown) =>
  err('invalid_input', msg, 400, details);
export const unauthorized = (msg = 'Unauthenticated') => err('unauthenticated', msg, 401);
export const forbidden = (msg = 'Forbidden') => err('forbidden', msg, 403);
export const notFound = (msg = 'Not found') => err('not_found', msg, 404);
export const conflict = (msg = 'Conflict', code = 'conflict') => err(code, msg, 409);
export const serverError = (msg = 'Internal server error') => err('internal', msg, 500);

export function errorFromAuthError(e: AuthError): NextResponse<ErrorBody> {
  const map: Record<string, number> = {
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    duplicate_key: 409,
    conflict: 409,
    invalid_input: 400,
    invalid_credentials: 401,
    invalid_token: 400,
    email_taken: 409,
    invalid_transition: 422,
  };
  const status = map[e.code] ?? 400;
  return NextResponse.json(
    { error: { code: e.code, message: e.message, details: e.details } },
    { status },
  );
}

export function toErrorResponse(e: unknown): NextResponse<ErrorBody> {
  if (e instanceof AuthError) return errorFromAuthError(e);
  // eslint-disable-next-line no-console
  console.error('unhandled route error', e);
  return serverError();
}
