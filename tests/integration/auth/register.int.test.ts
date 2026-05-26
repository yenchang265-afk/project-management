// POST /api/auth/register: end-to-end through the route handler against real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startAuthIntegrationContext,
  stopAuthIntegrationContext,
  type AuthIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('POST /api/auth/register', () => {
  let ctx: AuthIntegrationContext;

  beforeAll(async () => {
    ctx = await startAuthIntegrationContext();
  }, 120_000);

  afterAll(async () => {
    await stopAuthIntegrationContext(ctx);
  });

  it('creates a user and returns 201', async () => {
    const { POST } = await import('@/../app/api/auth/register/route');
    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'reg-ok@example.com',
        password: 'super-secret-1',
        name: 'Reg Ok',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; email: string };
    expect(body.email).toBe('reg-ok@example.com');
    expect(body.id).toBeTruthy();
  });

  it('returns 409 on duplicate email', async () => {
    const { POST } = await import('@/../app/api/auth/register/route');
    const body = JSON.stringify({
      email: 'reg-dup@example.com',
      password: 'super-secret-1',
      name: 'Dup',
    });
    const first = await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(first.status).toBe(201);
    const second = await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(second.status).toBe(409);
  });

  it('returns 400 for invalid input', async () => {
    const { POST } = await import('@/../app/api/auth/register/route');
    const res = await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nope', password: 'x' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
