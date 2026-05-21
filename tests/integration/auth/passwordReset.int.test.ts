// Full forgot → reset flow against real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startAuthIntegrationContext,
  stopAuthIntegrationContext,
  type AuthIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('forgot → reset password flow', () => {
  let ctx: AuthIntegrationContext;

  beforeAll(async () => {
    ctx = await startAuthIntegrationContext();
    const { POST } = await import('@/../app/api/auth/register/route');
    await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'reset@example.com',
          password: 'old-password-1',
          name: 'Reset',
        }),
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await stopAuthIntegrationContext(ctx);
  });

  it('always returns 204 from forgot-password (no enumeration)', async () => {
    const { POST } = await import('@/../app/api/auth/forgot-password/route');
    const res = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ghost@example.com' }),
      }),
    );
    expect(res.status).toBe(204);
  });

  it('rotates the password through forgot → reset and invalidates the old one', async () => {
    const { POST: forgot } = await import('@/../app/api/auth/forgot-password/route');
    const forgotRes = await forgot(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset@example.com' }),
      }),
    );
    expect(forgotRes.status).toBe(204);

    // Pull the freshly-issued token out of the DB (the email side ships in Phase 4).
    const { prisma } = await import('@/server/db');
    const user = await prisma.user.findUnique({ where: { email: 'reset@example.com' } });
    expect(user?.passwordResetToken).toBeTruthy();

    // Re-issue so the test owns the plaintext token.
    const { createAuthService, AuthError } = await import('@/server/services/auth');
    const svc = createAuthService({ prisma });
    const token = await svc.createPasswordResetToken('reset@example.com');
    expect(token).toBeTruthy();

    const { POST: reset } = await import('@/../app/api/auth/reset-password/route');
    const resetRes = await reset(
      new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'brand-new-pwd-2' }),
      }),
    );
    expect(resetRes.status).toBe(204);

    // Old password no longer works
    await expect(
      svc.verifyCredentials({ email: 'reset@example.com', password: 'old-password-1' }),
    ).rejects.toBeInstanceOf(AuthError);

    // New password works
    const after = await svc.verifyCredentials({
      email: 'reset@example.com',
      password: 'brand-new-pwd-2',
    });
    expect(after.email).toBe('reset@example.com');
  });

  it('returns 400 for an invalid reset token', async () => {
    const { POST: reset } = await import('@/../app/api/auth/reset-password/route');
    const res = await reset(
      new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token', newPassword: 'whatever-1' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
