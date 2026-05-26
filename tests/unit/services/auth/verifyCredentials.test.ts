import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { AuthError, createAuthService } from '@/server/services/auth';

describe('auth.verifyCredentials', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createAuthService({ prisma: prisma as never });
    await service.register({
      email: 'bob@example.com',
      password: 'right-password',
      name: 'Bob',
    });
  });

  it('returns the user when credentials match', async () => {
    const user = await service.verifyCredentials({
      email: 'bob@example.com',
      password: 'right-password',
    });
    expect(user.email).toBe('bob@example.com');
  });

  it('throws AuthError("invalid_credentials") when password is wrong', async () => {
    await expect(
      service.verifyCredentials({
        email: 'bob@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'invalid_credentials',
    });
  });

  it('throws AuthError("invalid_credentials") for unknown email (no enumeration)', async () => {
    await expect(
      service.verifyCredentials({
        email: 'nobody@example.com',
        password: 'right-password',
      }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'invalid_credentials',
    });
  });

  it('rejects users with no passwordHash (e.g. magic-link-only accounts)', async () => {
    // Manually wipe the password hash to simulate a magic-link-only user.
    const users = [...prisma._state.users.values()];
    const target = users[0];
    if (!target) throw new Error('expected a user');
    target.passwordHash = null;

    await expect(
      service.verifyCredentials({
        email: 'bob@example.com',
        password: 'right-password',
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
