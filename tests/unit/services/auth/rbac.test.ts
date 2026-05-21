import { describe, expect, it } from 'vitest';
import { ROLE_RANK, hasRoleAtLeast, requireRole } from '@/server/auth/roles';
import { AuthError } from '@/lib/errors';

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

// requireProjectAccess unit-tests now live in
// tests/unit/services/projects/requireProjectAccess.test.ts (Phase 2 fill-in).
