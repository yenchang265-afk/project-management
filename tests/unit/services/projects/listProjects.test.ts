import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { createProjectsService } from '@/server/services/projects';

describe('projects.listProjects', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createProjectsService>;
  let adminId: string;
  let leadId: string;
  let viewerId: string;
  let viewerMemberProjectId: string;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createProjectsService({ prisma: prisma as never });

    const admin = await prisma.user.create({ data: { email: 'a@e.com', name: 'A' } });
    adminId = admin.id;
    await prisma.orgMembership.create({ data: { userId: adminId, role: 'ADMIN' } });

    const lead = await prisma.user.create({ data: { email: 'l@e.com', name: 'L' } });
    leadId = lead.id;
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });

    const viewer = await prisma.user.create({ data: { email: 'v@e.com', name: 'V' } });
    viewerId = viewer.id;
    await prisma.orgMembership.create({ data: { userId: viewerId, role: 'VIEWER' } });

    // Three projects: P1 (lead leads, viewer is a member), P2 (lead leads, viewer not member), P3 (archived)
    const p1 = await service.createProject(
      { key: 'PA', name: 'P1', leadId },
      { id: leadId, role: 'LEAD' },
    );
    viewerMemberProjectId = p1.id;
    await prisma.projectMember.create({
      data: { projectId: p1.id, userId: viewerId, role: 'VIEWER' },
    });

    await service.createProject({ key: 'PB', name: 'P2', leadId }, { id: leadId, role: 'LEAD' });

    const p3 = await service.createProject(
      { key: 'PC', name: 'P3', leadId },
      { id: leadId, role: 'LEAD' },
    );
    await service.archiveProject(p3.id, { id: leadId, role: 'LEAD' });
  });

  it('VIEWER sees only projects where they are a member, defaults to non-archived', async () => {
    const list = await service.listProjects({ id: viewerId, role: 'VIEWER' }, {});
    expect(list.map((p) => p.id)).toEqual([viewerMemberProjectId]);
  });

  it('ADMIN sees all non-archived projects by default', async () => {
    const list = await service.listProjects({ id: adminId, role: 'ADMIN' }, {});
    expect(list.map((p) => p.key).sort()).toEqual(['PA', 'PB']);
  });

  it('includeArchived=true returns archived projects too', async () => {
    const list = await service.listProjects(
      { id: adminId, role: 'ADMIN' },
      { includeArchived: true },
    );
    expect(list.map((p) => p.key).sort()).toEqual(['PA', 'PB', 'PC']);
  });
});
