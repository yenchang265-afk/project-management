import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { createProjectsService } from '@/server/services/projects';

describe('projects.getProjectByKey', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createProjectsService>;
  let leadId: string;
  let memberId: string;
  let viewerId: string;
  let outsiderId: string;
  let adminId: string;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createProjectsService({ prisma: prisma as never });

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

    const p = await service.createProject(
      { key: 'KEY', name: 'K', leadId },
      { id: leadId, role: 'LEAD' },
    );
    // member is project MEMBER, viewer is project LEAD (will become max of org+project)
    await prisma.projectMember.create({
      data: { projectId: p.id, userId: memberId, role: 'MEMBER' },
    });
    await prisma.projectMember.create({
      data: { projectId: p.id, userId: viewerId, role: 'LEAD' },
    });
  });

  it('returns viewerRole = max(org, project)', async () => {
    // viewer: org=VIEWER, project=LEAD → LEAD
    const v = await service.getProjectByKey('KEY', { id: viewerId, role: 'VIEWER' });
    expect(v.viewerRole).toBe('LEAD');

    // member: org=MEMBER, project=MEMBER → MEMBER
    const m = await service.getProjectByKey('KEY', { id: memberId, role: 'MEMBER' });
    expect(m.viewerRole).toBe('MEMBER');

    // lead: org=LEAD, project=LEAD → LEAD
    const l = await service.getProjectByKey('KEY', { id: leadId, role: 'LEAD' });
    expect(l.viewerRole).toBe('LEAD');
  });

  it('404 when project key not found', async () => {
    await expect(
      service.getProjectByKey('NONE', { id: leadId, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('403 when user is not a project member and not org ADMIN', async () => {
    await expect(
      service.getProjectByKey('KEY', { id: outsiderId, role: 'VIEWER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('ADMIN can access any project even without project membership', async () => {
    const r = await service.getProjectByKey('KEY', { id: adminId, role: 'ADMIN' });
    expect(r.viewerRole).toBe('ADMIN');
  });
});
