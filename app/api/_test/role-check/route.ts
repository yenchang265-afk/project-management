// Test-only route exercising requireUserWithRole('LEAD'). Lives under
// /_test so it's obvious it isn't a real surface; integration tests import
// the handler directly. Disabled in production to be safe.

import { NextResponse } from 'next/server';

import { AuthError } from '@/lib/errors';
import { requireUserWithRole } from '@/server/auth/guards';

export async function GET(_req: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const user = await requireUserWithRole('LEAD');
    return NextResponse.json({ ok: true, role: user.role });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === 'unauthenticated' ? 401 : 403;
      return NextResponse.json({ error: { code: err.code } }, { status });
    }
    throw err;
  }
}
