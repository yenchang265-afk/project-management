// POST /api/auth/register — thin route handler delegating to the auth service.
// Translates AuthError codes into the appropriate HTTP statuses.

import { NextResponse } from 'next/server';

import { AuthError } from '@/lib/errors';
import { prisma } from '@/server/db';
import { createAuthService } from '@/server/services/auth';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
  }

  const svc = createAuthService({ prisma });
  try {
    const user = await svc.register(body as Parameters<typeof svc.register>[0]);
    return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === 'email_taken' ? 409 : 400;
      return NextResponse.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        { status },
      );
    }
    // eslint-disable-next-line no-console
    console.error('register failed', err);
    return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
  }
}
