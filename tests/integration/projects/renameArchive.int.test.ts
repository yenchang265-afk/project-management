// PATCH + archive endpoints — RBAC matrix.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  startProjectsIntegrationContext,
  stopProjectsIntegrationContext,
  type ProjectsIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('PATCH + archive /api/projects/[key]', () => {
  let ctx: ProjectsIntegrationContext;
  let leadId: string;
  let memberId: string;
  const projectKey = 'EDITA';

  beforeAll(async () => {
    ctx = await startProjectsIntegrationContext();
    const { POST: register } = await import('@/../app/api/auth/register/route');
    const leadRes = await register(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'l@e.com', password: 'pass-1234', name: 'L' }),
      }),
    );
    leadId = ((await leadRes.json()) as { id: string }).id;
    const memRes = await register(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'm@e.com', password: 'pass-1234', name: 'M' }),
      }),
    );
    memberId = ((await memRes.json()) as { id: string }).id;
    const { prisma } = await import('@/server/db');
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });

    const { createProjectsService } = await import('@/server/services/projects');
    const svc = createProjectsService({ prisma });
    const p = await svc.createProject(
      { key: projectKey, name: 'E', leadId },
      { id: leadId, role: 'LEAD' },
    );
    await prisma.projectMember.create({
      data: { projectId: p.id, userId: memberId, role: 'MEMBER' },
    });
  }, 180_000);

  afterAll(async () => {
    await stopProjectsIntegrationContext(ctx);
    vi.restoreAllMocks();
  });

  function mockSession(userId: string | null) {
    vi.doMock('@/server/auth', () => ({
      auth: vi
        .fn()
        .mockResolvedValue(userId ? { user: { id: userId, email: 'x@e.com', name: 'X' } } : null),
    }));
    vi.resetModules();
  }

  it('LEAD can rename via PATCH', async () => {
    mockSession(leadId);
    const { PATCH } = await import('@/../app/api/projects/[key]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/projects/${projectKey}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      { params: Promise.resolve({ key: projectKey }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { name: string } };
    expect(body.project.name).toBe('Renamed');
    vi.doUnmock('@/server/auth');
  });

  it('MEMBER cannot rename (403)', async () => {
    mockSession(memberId);
    const { PATCH } = await import('@/../app/api/projects/[key]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/projects/${projectKey}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Should fail' }),
      }),
      { params: Promise.resolve({ key: projectKey }) },
    );
    expect(res.status).toBe(403);
    vi.doUnmock('@/server/auth');
  });

  it('MEMBER cannot archive (403)', async () => {
    mockSession(memberId);
    const { POST } = await import('@/../app/api/projects/[key]/archive/route');
    const res = await POST(
      new Request(`http://localhost/api/projects/${projectKey}/archive`, { method: 'POST' }),
      { params: Promise.resolve({ key: projectKey }) },
    );
    expect(res.status).toBe(403);
    vi.doUnmock('@/server/auth');
  });

  it('LEAD can archive, and re-archive is idempotent (200 both times)', async () => {
    mockSession(leadId);
    const { POST } = await import('@/../app/api/projects/[key]/archive/route');
    const first = await POST(
      new Request(`http://localhost/api/projects/${projectKey}/archive`, { method: 'POST' }),
      { params: Promise.resolve({ key: projectKey }) },
    );
    expect(first.status).toBe(200);
    const second = await POST(
      new Request(`http://localhost/api/projects/${projectKey}/archive`, { method: 'POST' }),
      { params: Promise.resolve({ key: projectKey }) },
    );
    expect(second.status).toBe(200);
    vi.doUnmock('@/server/auth');
  });
});
