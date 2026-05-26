// Integration test for GET /api/admin/audit/export.csv.
//
// Verifies:
//   - ADMIN gets a 200 with text/csv content-type and Content-Disposition.
//   - The streamed body contains the header row and the seeded events.
//   - Payloads with commas + quotes are properly CSV-escaped.

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

describe.skipIf(!dockerAvailable)('GET /api/admin/audit/export.csv', () => {
  let ctx: AuditIntegrationContext;
  let adminId: string;

  beforeAll(async () => {
    ctx = await startAuditIntegrationContext();
    adminId = await registerUser('admin.exp@example.com');
    await setOrgRole(adminId, 'ADMIN');

    const { prisma } = await import('@/server/db');
    const { createAuditService } = await import('@/server/services/audit');
    const svc = createAuditService({ prisma });
    await svc.recordAuditEvent({
      kind: 'project.renamed',
      actorId: adminId,
      payload: { name: 'tricky, "quoted" name' },
    });
    await svc.recordAuditEvent({
      kind: 'auth.login',
      actorId: adminId,
      payload: { ok: true },
    });
  }, 240_000);

  afterAll(async () => {
    await stopAuditIntegrationContext(ctx);
  });

  it('streams CSV with the expected header + rows for ADMIN', async () => {
    const res = await withSession(adminId, async () => {
      const { GET } = await import('@/../app/api/admin/audit/export.csv/route');
      return GET(new Request('http://localhost/api/admin/audit/export.csv'));
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const body = await res.text();
    const lines = body.trim().split('\n');
    expect(lines[0]).toBe('id,at,kind,actorId,actorEmail,target,payload');
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 rows
    expect(body).toContain('project.renamed');
    expect(body).toContain('auth.login');
    expect(body).toContain('admin.exp@example.com');
  });

  it('escapes commas and quotes in payload', async () => {
    const res = await withSession(adminId, async () => {
      const { GET } = await import('@/../app/api/admin/audit/export.csv/route');
      return GET(new Request('http://localhost/api/admin/audit/export.csv?kind=project.renamed'));
    });
    const body = await res.text();
    // Payload field must be quoted (contains comma) and contain doubled
    // inner quotes ("" instead of ").
    expect(body).toMatch(
      /"\{""name"":""tricky, \\"quoted\\" name""\}"|"\{""name"":""tricky, \\\\""quoted\\\\"" name""\}"|"\{""name"":""tricky, ""quoted"" name""\}"/,
    );
  });
});
