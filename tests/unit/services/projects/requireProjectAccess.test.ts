// Unit tests for the requireProjectAccess guard (Phase 2 fill-in).
// We mock `@/server/auth` to control the session and `@/server/db` so the
// guard hits our fake Prisma. The projects service is the source of truth
// for project lookup + viewerRole.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@prisma/client';
import { createFakePrisma, type FakePrisma } from './fakePrisma';

describe('requireProjectAccess', () => {
  let prisma: FakePrisma;
  let leadId: string;
  let viewerId: string;
  let memberId: string;
  let outsiderId: string;
  let adminId: string;
  const projectKey = 'KEY';

  beforeEach(async () => {
    vi.resetModules();
    prisma = createFakePrisma();

    const lead = await prisma.user.create({ data: { email: 'l@e.com', name: 'L' } });
    leadId = lead.id;
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });

    const member = await prisma.user.create({ data: { email: 'm@e.com', name: 'M' } });
    memberId = member.id;
    await prisma.orgMembership.create({ data: { userId: memberId, role: 'MEMBER' } });

    const viewer = await prisma.user.create({ data: { email: 'v@e.com', name: 'V' } });
    viewerId = viewer.id;
    await prisma.orgMembership.create({ data: { userId: viewerId, role: 'VIEWER' } });

    const outsider = await prisma.user.create({ data: { email: 'o@e.com', name: 'O' } });
    outsiderId = outsider.id;
    await prisma.orgMembership.create({ data: { userId: outsiderId, role: 'VIEWER' } });

    const admin = await prisma.user.create({ data: { email: 'a@e.com', name: 'A' } });
    adminId = admin.id;
    await prisma.orgMembership.create({ data: { userId: adminId, role: 'ADMIN' } });

    vi.doMock('@/server/db', () => ({ prisma }));

    const { createProjectsService } = await import('@/server/services/projects');
    const svc = createProjectsService({ prisma: prisma as never });
    const p = await svc.createProject(
      { key: projectKey, name: 'K', leadId },
      { id: leadId, role: 'LEAD' },
    );
    await prisma.projectMember.create({
      data: { projectId: p.id, userId: memberId, role: 'MEMBER' },
    });
    await prisma.projectMember.create({
      data: { projectId: p.id, userId: viewerId, role: 'LEAD' },
    });
  });

  async function call(sessionUserId: string | null, sessionRole: Role | undefined, min: Role) {
    vi.doMock('@/server/auth', () => ({
      auth: vi
        .fn()
        .mockResolvedValue(
          sessionUserId
            ? { user: { id: sessionUserId, email: 'x@e.com', name: 'X', role: sessionRole } }
            : null,
        ),
    }));
    const { requireProjectAccess } = await import('@/server/auth/projectAccess');
    return requireProjectAccess(projectKey, min);
  }

  it('throws unauthenticated when no session', async () => {
    await expect(call(null, undefined, 'VIEWER')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('throws not_found when project key is missing', async () => {
    vi.doMock('@/server/auth', () => ({
      auth: vi
        .fn()
        .mockResolvedValue({ user: { id: leadId, email: 'l@e.com', name: 'L', role: 'LEAD' } }),
    }));
    const { requireProjectAccess } = await import('@/server/auth/projectAccess');
    await expect(requireProjectAccess('GHOST', 'VIEWER')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('throws forbidden when user has no project access (outsider)', async () => {
    await expect(call(outsiderId, 'VIEWER', 'VIEWER')).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('throws forbidden when effective role is below min', async () => {
    // member has project=MEMBER, requiring LEAD
    await expect(call(memberId, 'MEMBER', 'LEAD')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows when project role meets min', async () => {
    const r = await call(viewerId, 'VIEWER', 'LEAD'); // project role LEAD
    expect(r.role).toBe('LEAD');
    expect(r.project.key).toBe(projectKey);
    expect(r.user.id).toBe(viewerId);
  });

  it('allows ADMIN globally even without project membership', async () => {
    const r = await call(adminId, 'ADMIN', 'LEAD');
    expect(r.role).toBe('ADMIN');
  });

  it('returns effective role as max(org, project)', async () => {
    // lead has org=LEAD, project=LEAD → LEAD
    const r = await call(leadId, 'LEAD', 'MEMBER');
    expect(r.role).toBe('LEAD');
  });
});
