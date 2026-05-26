// Exercises the requireUserWithRole guard via a test-only route handler that
// gates on LEAD. We construct mock requireUser results by stubbing the
// `auth()` import (the actual Auth.js HTTP cookie flow is e2e territory).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  startAuthIntegrationContext,
  stopAuthIntegrationContext,
  type AuthIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('RBAC: /api/_test/role-check (LEAD-gated)', () => {
  let ctx: AuthIntegrationContext;
  let memberId: string;
  let leadId: string;

  beforeAll(async () => {
    ctx = await startAuthIntegrationContext();
    const { POST } = await import('@/../app/api/auth/register/route');
    const memberRes = await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'member@example.com',
          password: 'password-1234',
          name: 'Member',
        }),
      }),
    );
    memberId = ((await memberRes.json()) as { id: string }).id;

    const leadRes = await POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'lead@example.com',
          password: 'password-1234',
          name: 'Lead',
        }),
      }),
    );
    leadId = ((await leadRes.json()) as { id: string }).id;
    const { prisma } = await import('@/server/db');
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });
  }, 120_000);

  afterAll(async () => {
    await stopAuthIntegrationContext(ctx);
    vi.restoreAllMocks();
  });

  async function callRoleCheck(sessionUserId: string | null) {
    vi.doMock('@/server/auth', () => ({
      auth: vi
        .fn()
        .mockResolvedValue(
          sessionUserId ? { user: { id: sessionUserId, email: 'x@example.com', name: 'X' } } : null,
        ),
    }));
    // Re-import so the route picks up the mocked auth()
    vi.resetModules();
    const { GET } = await import('@/../app/api/_test/role-check/route');
    const res = await GET(new Request('http://localhost/api/_test/role-check'));
    vi.doUnmock('@/server/auth');
    return res;
  }

  it('returns 401 when unauthenticated', async () => {
    const res = await callRoleCheck(null);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a MEMBER', async () => {
    const res = await callRoleCheck(memberId);
    expect(res.status).toBe(403);
  });

  it('returns 200 for a LEAD', async () => {
    const res = await callRoleCheck(leadId);
    expect(res.status).toBe(200);
  });
});
