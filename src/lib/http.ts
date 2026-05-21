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
