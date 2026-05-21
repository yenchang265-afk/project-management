import { describe, expect, it } from 'vitest';
import { ROLE_RANK, hasRoleAtLeast, requireRole } from '@/server/auth/roles';
import { AuthError, NotImplementedError } from '@/lib/errors';

// requireProjectAccess lives in guards.ts which imports next-auth; we re-export
// it from a tiny shim that doesn't pull in next/server, so it's unit-testable.
import { requireProjectAccess } from '@/server/auth/projectAccess';

describe('role hierarchy', () => {
  it('orders ADMIN > LEAD > MEMBER > VIEWER', () => {
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.LEAD);
    expect(ROLE_RANK.LEAD).toBeGreaterThan(ROLE_RANK.MEMBER);
    expect(ROLE_RANK.MEMBER).toBeGreaterThan(ROLE_RANK.VIEWER);
  });

  it('hasRoleAtLeast respects hierarchy', () => {
    expect(hasRoleAtLeast('ADMIN', 'LEAD')).toBe(true);
    expect(hasRoleAtLeast('LEAD', 'MEMBER')).toBe(true);
    expect(hasRoleAtLeast('MEMBER', 'MEMBER')).toBe(true);
    expect(hasRoleAtLeast('VIEWER', 'MEMBER')).toBe(false);
    expect(hasRoleAtLeast('MEMBER', 'LEAD')).toBe(false);
  });
});

describe('requireRole', () => {
  it('passes when the caller role meets the threshold', () => {
    expect(() => requireRole('LEAD', 'MEMBER')).not.toThrow();
    expect(() => requireRole('ADMIN', 'ADMIN')).not.toThrow();
  });

  it('throws AuthError("forbidden") when the role is insufficient', () => {
    expect(() => requireRole('MEMBER', 'LEAD')).toThrow(AuthError);
    try {
      requireRole('VIEWER', 'MEMBER');
    } catch (err) {
      expect((err as AuthError).code).toBe('forbidden');
    }
  });
});

describe('requireProjectAccess (stub for Phase 1)', () => {
  it('throws NotImplementedError — Phase 2 will fill this in', async () => {
    await expect(requireProjectAccess('ANYKEY', 'MEMBER')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
