// Integration test for the auth.* → AuditEvent subscriber wiring.
//
// Registers a user through the real /api/auth/register route, then asserts a
// matching AuditEvent row appears in the DB.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startAuditIntegrationContext,
  stopAuditIntegrationContext,
  type AuditIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('audit subscribers (integration)', () => {
  let ctx: AuditIntegrationContext;

  beforeAll(async () => {
    ctx = await startAuditIntegrationContext();

    // Wire the audit subscribers as bootstrap.ts would.
    const { prisma } = await import('@/server/db');
    const { createAuditService } = await import('@/server/services/audit');
    const { registerAuditSubscribers, __resetAuditSubscribers } =
      await import('@/server/services/audit/subscribers');
    __resetAuditSubscribers();
    const svc = createAuditService({ prisma });
    registerAuditSubscribers({ record: (i) => svc.recordAuditEvent(i) });
  }, 240_000);

  afterAll(async () => {
    const { __resetAuditSubscribers } = await import('@/server/services/audit/subscribers');
    __resetAuditSubscribers();
    await stopAuditIntegrationContext(ctx);
  });

  it('registering a user records an auth.register AuditEvent', async () => {
    const email = `sub-${Date.now()}@example.com`;
    const { POST: register } = await import('@/../app/api/auth/register/route');
    const res = await register(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password-1234', name: 'Sub Tester' }),
      }),
    );
    expect(res.status).toBe(201);
    const { id: userId } = (await res.json()) as { id: string };

    // Subscribers fire on the synchronous publish() path; give a tick for safety.
    await new Promise((r) => setTimeout(r, 25));

    const { prisma } = await import('@/server/db');
    const events = await prisma.auditEvent.findMany({
      where: { kind: 'auth.register', actorId: userId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ email });
  });
});
