// Pure role-hierarchy helpers. Kept in a separate module from `guards.ts`
// so unit tests can import them without booting the next-auth runtime.

import type { Role } from '@prisma/client';

import { AuthError } from '@/lib/errors';

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MEMBER: 1,
  LEAD: 2,
  ADMIN: 3,
};

export function hasRoleAtLeast(actual: Role, min: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}

export function requireRole(actual: Role, min: Role): void {
  if (!hasRoleAtLeast(actual, min)) {
    throw new AuthError('forbidden', `Requires role ${min} or higher`);
  }
}
