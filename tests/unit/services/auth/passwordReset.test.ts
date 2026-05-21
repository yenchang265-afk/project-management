import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { AuthError, createAuthService } from '@/server/services/auth';

describe('auth password reset', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createAuthService({ prisma: prisma as never });
    await service.register({
      email: 'carol@example.com',
      password: 'original-password',
      name: 'Carol',
    });
  });

  describe('createPasswordResetToken', () => {
    it('returns an opaque token string for an existing user', async () => {
      const token = await service.createPasswordResetToken('carol@example.com');
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThanOrEqual(32);
      // The plaintext token must not be stored verbatim — only a hash of it.
      const stored = [...prisma._state.users.values()][0];
      expect(stored?.passwordResetToken).toBeTruthy();
      expect(stored?.passwordResetToken).not.toBe(token);
      expect(stored?.passwordResetExpires).toBeInstanceOf(Date);
    });

    it('emits an "auth.password_reset_requested" domain event', async () => {
      const onEvent = vi.fn();
      const s = createAuthService({ prisma: prisma as never, onEvent });
      await s.createPasswordResetToken('carol@example.com');
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth.password_reset_requested',
          payload: expect.objectContaining({ email: 'carol@example.com' }),
        }),
      );
    });

    it('returns null and does not throw when the email is unknown (no enumeration)', async () => {
      const result = await service.createPasswordResetToken('ghost@example.com');
      expect(result).toBeNull();
    });
  });

  describe('resetPassword', () => {
    it('updates the password when the token is valid', async () => {
      const token = await service.createPasswordResetToken('carol@example.com');
      if (!token) throw new Error('expected a token');

      await service.resetPassword({ token, newPassword: 'brand-new-password' });

      // Old password should now fail.
      await expect(
        service.verifyCredentials({
          email: 'carol@example.com',
          password: 'original-password',
        }),
      ).rejects.toBeInstanceOf(AuthError);

      // New password should work.
      const user = await service.verifyCredentials({
        email: 'carol@example.com',
        password: 'brand-new-password',
      });
      expect(user.email).toBe('carol@example.com');

      // Token should be cleared.
      const stored = [...prisma._state.users.values()][0];
      expect(stored?.passwordResetToken).toBeNull();
      expect(stored?.passwordResetExpires).toBeNull();
    });

    it('rejects an unknown token', async () => {
      await expect(
        service.resetPassword({ token: 'totally-bogus-token', newPassword: 'whatever-works' }),
      ).rejects.toMatchObject({ code: 'invalid_token' });
    });

    it('rejects an expired token', async () => {
      const token = await service.createPasswordResetToken('carol@example.com');
      if (!token) throw new Error('expected a token');
      // Force expiry into the past.
      const stored = [...prisma._state.users.values()][0];
      if (!stored) throw new Error('expected a user');
      stored.passwordResetExpires = new Date(Date.now() - 60_000);

      await expect(
        service.resetPassword({ token, newPassword: 'brand-new-password' }),
      ).rejects.toMatchObject({ code: 'invalid_token' });
    });

    it('rejects a new password that does not meet the policy', async () => {
      const token = await service.createPasswordResetToken('carol@example.com');
      if (!token) throw new Error('expected a token');
      await expect(service.resetPassword({ token, newPassword: 'short' })).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });
});
