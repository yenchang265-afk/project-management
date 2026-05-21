// Cross-cutting authorization helpers consumed by every Phase 2+ slice.
// Contract:
//   requireUser()           — returns the current session user; throws AuthError("unauthenticated") if absent.
//   requireRole(actual,min) — throws AuthError("forbidden") if actual is below min.
//   requireProjectAccess()  — STUB. Phase 2 fills in real project membership lookups.

import type { Role } from '@prisma/client';

import { AuthError, NotImplementedError } from '@/lib/errors';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { createAuthService } from '@/server/services/auth';

export { NotImplementedError } from '@/lib/errors';
export { ROLE_RANK, hasRoleAtLeast, requireRole } from '@/server/auth/roles';
export { requireProjectAccess } from '@/server/auth/projectAccess';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
};

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) {
    throw new AuthError('unauthenticated');
  }
  const role = (session.user?.role as Role | undefined) ?? 'MEMBER';
  return {
    id: userId,
    email: session.user?.email ?? '',
    name: session.user?.name ?? null,
    role,
  };
}

export async function requireUserWithRole(min: Role): Promise<SessionUser> {
  const user = await requireUser();
  // Re-read role from the DB so revoked roles take effect immediately even
  // before the JWT expires.
  const service = createAuthService({ prisma });
  const role = await service.getMembershipRole(user.id);
  const { requireRole } = await import('@/server/auth/roles');
  requireRole(role, min);
  return { ...user, role };
}
