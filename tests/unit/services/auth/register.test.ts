import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { AuthError, createAuthService } from '@/server/services/auth';

describe('auth.register', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    service = createAuthService({ prisma: prisma as never });
  });

  it('creates a new user with a hashed password', async () => {
    const user = await service.register({
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });

    expect(user.id).toBeTruthy();
    expect(user.email).toBe('alice@example.com');
    expect(user.name).toBe('Alice');
    // Password must be hashed, not stored verbatim
    const stored = prisma._state.users.get(user.id);
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('correct-horse-battery');
  });

  it('rejects duplicate emails with AuthError("email_taken")', async () => {
    await service.register({
      email: 'dup@example.com',
      password: 'password-123',
      name: 'First',
    });

    await expect(
      service.register({
        email: 'dup@example.com',
        password: 'password-456',
        name: 'Second',
      }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'email_taken',
    });
  });

  it('rejects weak passwords (under 8 chars) before hitting the DB', async () => {
    await expect(
      service.register({
        email: 'weak@example.com',
        password: 'short',
        name: 'Weak',
      }),
    ).rejects.toBeInstanceOf(AuthError);
    // No user should have been created.
    expect(prisma._state.users.size).toBe(0);
  });

  it('rejects malformed email', async () => {
    await expect(
      service.register({
        email: 'not-an-email',
        password: 'password-123',
        name: 'Bad',
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
