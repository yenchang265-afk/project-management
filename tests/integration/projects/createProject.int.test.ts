// POST /api/projects with RBAC enforcement, against real Postgres.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  startProjectsIntegrationContext,
  stopProjectsIntegrationContext,
  type ProjectsIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('POST /api/projects', () => {
  let ctx: ProjectsIntegrationContext;
  let memberId: string;
  let leadId: string;

  beforeAll(async () => {
    ctx = await startProjectsIntegrationContext();
    const { POST: register } = await import('@/../app/api/auth/register/route');
    const memberRes = await register(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'mem@example.com',
          password: 'password-1234',
          name: 'Mem',
        }),
      }),
    );
    memberId = ((await memberRes.json()) as { id: string }).id;
    const leadRes = await register(
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
  }, 180_000);

  afterAll(async () => {
    await stopProjectsIntegrationContext(ctx);
    vi.restoreAllMocks();
  });

  async function callPost(sessionUserId: string | null, body: unknown) {
    vi.doMock('@/server/auth', () => ({
      auth: vi
        .fn()
        .mockResolvedValue(
          sessionUserId ? { user: { id: sessionUserId, email: 'x@e.com', name: 'X' } } : null,
        ),
    }));
    vi.resetModules();
    const { POST } = await import('@/../app/api/projects/route');
    const res = await POST(
      new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    vi.doUnmock('@/server/auth');
    return res;
  }

  it('LEAD can create a project (201)', async () => {
    const res = await callPost(leadId, { key: 'ALPHA', name: 'Alpha', leadId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; key: string };
    expect(body.key).toBe('ALPHA');
  });

  it('MEMBER cannot create a project (403)', async () => {
    const res = await callPost(memberId, { key: 'BETA', name: 'B', leadId: memberId });
    expect(res.status).toBe(403);
  });

  it('duplicate key returns 409', async () => {
    const first = await callPost(leadId, { key: 'GAMMA', name: 'G', leadId });
    expect(first.status).toBe(201);
    const second = await callPost(leadId, { key: 'GAMMA', name: 'G2', leadId });
    expect(second.status).toBe(409);
  });

  it('invalid key returns 400', async () => {
    const res = await callPost(leadId, { key: 'bad', name: 'bad', leadId });
    expect(res.status).toBe(400);
  });
});
