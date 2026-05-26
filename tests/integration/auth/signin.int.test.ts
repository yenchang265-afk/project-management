// Credentials sign-in via the auth service (the Auth.js HTTP flow itself is
// exercised in the e2e suite; here we just validate the service path the
// Credentials provider's authorize() function calls into).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startAuthIntegrationContext,
  stopAuthIntegrationContext,
  type AuthIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('credentials sign-in', () => {
  let ctx: AuthIntegrationContext;

  beforeAll(async () => {
    ctx = await startAuthIntegrationContext();
    const { POST } = await import('@/../app/api/auth/register/route');
    await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'signin@example.com',
          password: 'right-password-1',
          name: 'Signin',
        }),
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await stopAuthIntegrationContext(ctx);
  });

  it('verifyCredentials succeeds with the right password', async () => {
    const { createAuthService } = await import('@/server/services/auth');
    const { prisma } = await import('@/server/db');
    const svc = createAuthService({ prisma });
    const user = await svc.verifyCredentials({
      email: 'signin@example.com',
      password: 'right-password-1',
    });
    expect(user.email).toBe('signin@example.com');
  });

  it('verifyCredentials throws on wrong password', async () => {
    const { createAuthService, AuthError } = await import('@/server/services/auth');
    const { prisma } = await import('@/server/db');
    const svc = createAuthService({ prisma });
    await expect(
      svc.verifyCredentials({ email: 'signin@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
