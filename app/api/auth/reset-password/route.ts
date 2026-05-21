// POST /api/auth/reset-password — consumes a one-time reset token.
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
    await svc.resetPassword(body as Parameters<typeof svc.resetPassword>[0]);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 400 },
      );
    }
    // eslint-disable-next-line no-console
    console.error('resetPassword failed', err);
    return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
  }
}
