// Integration test for GET /api/admin/audit.
//
// RBAC matrix:
//   - anon         → 401
//   - MEMBER       → 403
//   - ADMIN        → 200 + list payload

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  registerUser,
  setOrgRole,
  startAuditIntegrationContext,
  stopAuditIntegrationContext,
  withSession,
  type AuditIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('GET /api/admin/audit', () => {
  let ctx: AuditIntegrationContext;
  let adminId: string;
  let memberId: string;

  beforeAll(async () => {
    ctx = await startAuditIntegrationContext();
    adminId = await registerUser('admin.aud@example.com');
    memberId = await registerUser('member.aud@example.com');
    await setOrgRole(adminId, 'ADMIN');
    await setOrgRole(memberId, 'MEMBER');

    // Seed an audit event so list isn't empty.
    const { prisma } = await import('@/server/db');
    const { createAuditService } = await import('@/server/services/audit');
    const svc = createAuditService({ prisma });
    await svc.recordAuditEvent({
      kind: 'auth.register',
      actorId: adminId,
      payload: { email: 'admin.aud@example.com' },
    });
  }, 240_000);

  afterAll(async () => {
    await stopAuditIntegrationContext(ctx);
  });

  it('returns 401 to anonymous callers', async () => {
    const res = await withSession(null, async () => {
      const { GET } = await import('@/../app/api/admin/audit/route');
      return GET(new Request('http://localhost/api/admin/audit'));
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 to MEMBER users', async () => {
    const res = await withSession(memberId, async () => {
      const { GET } = await import('@/../app/api/admin/audit/route');
      return GET(new Request('http://localhost/api/admin/audit'));
    });
    expect(res.status).toBe(403);
  });

  it('returns 200 + paginated payload to ADMIN', async () => {
    const res = await withSession(adminId, async () => {
      const { GET } = await import('@/../app/api/admin/audit/route');
      return GET(new Request('http://localhost/api/admin/audit'));
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; kind: string }>;
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.some((r) => r.kind === 'auth.register')).toBe(true);
    expect(body.pageInfo).toBeDefined();
  });

  it('filters by kind query parameter', async () => {
    const res = await withSession(adminId, async () => {
      const { GET } = await import('@/../app/api/admin/audit/route');
      return GET(new Request('http://localhost/api/admin/audit?kind=auth.register'));
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ kind: string }> };
    for (const r of body.data) expect(r.kind).toBe('auth.register');
  });
});
