// list + get-by-key endpoints with RBAC.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  startProjectsIntegrationContext,
  stopProjectsIntegrationContext,
  type ProjectsIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('GET /api/projects and /api/projects/[key]', () => {
  let ctx: ProjectsIntegrationContext;
  let leadId: string;
  let memberId: string;
  let projectKey = 'LISTA';

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
    await svc.createProject({ key: projectKey, name: 'L', leadId }, { id: leadId, role: 'LEAD' });
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

  it('LEAD sees the project in list', async () => {
    mockSession(leadId);
    const { GET } = await import('@/../app/api/projects/route');
    const res = await GET(new Request('http://localhost/api/projects'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { key: string }[] };
    expect(body.projects.find((p) => p.key === projectKey)).toBeTruthy();
    vi.doUnmock('@/server/auth');
  });

  it('non-member MEMBER sees an empty list', async () => {
    mockSession(memberId);
    const { GET } = await import('@/../app/api/projects/route');
    const res = await GET(new Request('http://localhost/api/projects'));
    const body = (await res.json()) as { projects: { key: string }[] };
    expect(body.projects.find((p) => p.key === projectKey)).toBeUndefined();
    vi.doUnmock('@/server/auth');
  });

  it('GET /api/projects/[key] returns project + viewerRole for the lead', async () => {
    mockSession(leadId);
    const { GET } = await import('@/../app/api/projects/[key]/route');
    const res = await GET(new Request(`http://localhost/api/projects/${projectKey}`), {
      params: Promise.resolve({ key: projectKey }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { key: string }; viewerRole: string };
    expect(body.project.key).toBe(projectKey);
    expect(body.viewerRole).toBe('LEAD');
    vi.doUnmock('@/server/auth');
  });

  it('GET /api/projects/[key] returns 403 for non-member', async () => {
    mockSession(memberId);
    const { GET } = await import('@/../app/api/projects/[key]/route');
    const res = await GET(new Request(`http://localhost/api/projects/${projectKey}`), {
      params: Promise.resolve({ key: projectKey }),
    });
    expect(res.status).toBe(403);
    vi.doUnmock('@/server/auth');
  });

  it('GET /api/projects/[key] returns 404 for unknown key', async () => {
    mockSession(leadId);
    const { GET } = await import('@/../app/api/projects/[key]/route');
    const res = await GET(new Request('http://localhost/api/projects/NOSUCH'), {
      params: Promise.resolve({ key: 'NOSUCH' }),
    });
    expect(res.status).toBe(404);
    vi.doUnmock('@/server/auth');
  });
});
