import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Phase 0: pass-through. Phase 1 adds auth/RBAC gating.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
