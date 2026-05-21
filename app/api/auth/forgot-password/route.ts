// POST /api/auth/forgot-password — always returns 204 to avoid leaking which
// emails are registered. The actual email delivery is queued via the domain
// event bus (Phase 4 ships the consumer).

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/server/db';
import { createAuthService } from '@/server/services/auth';

const inputSchema = z.object({ email: z.string() });

export async function POST(req: Request): Promise<Response> {
  let parsed: { email: string };
  try {
    parsed = inputSchema.parse(await req.json());
  } catch {
    // Even on malformed input we don't leak — but we do return 204 so callers
    // can't distinguish "bad email" from "unknown email".
    return new NextResponse(null, { status: 204 });
  }

  const svc = createAuthService({ prisma });
  await svc.createPasswordResetToken(parsed.email);
  return new NextResponse(null, { status: 204 });
}
