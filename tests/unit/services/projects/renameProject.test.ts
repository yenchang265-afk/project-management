import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { createProjectsService } from '@/server/services/projects';

describe('projects.renameProject', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createProjectsService>;
  let leadId: string;
  let memberId: string;
  let adminId: string;
  let projectId: string;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createProjectsService({ prisma: prisma as never });

    const lead = await prisma.user.create({ data: { email: 'l@e.com', name: 'L' } });
    leadId = lead.id;
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });

    const member = await prisma.user.create({ data: { email: 'm@e.com', name: 'M' } });
    memberId = member.id;
    await prisma.orgMembership.create({ data: { userId: memberId, role: 'MEMBER' } });

    const admin = await prisma.user.create({ data: { email: 'a@e.com', name: 'A' } });
    adminId = admin.id;
    await prisma.orgMembership.create({ data: { userId: adminId, role: 'ADMIN' } });

    const proj = await service.createProject(
      { key: 'PRJ', name: 'Initial', leadId },
      { id: leadId, role: 'LEAD' },
    );
    projectId = proj.id;
    // Add member as a MEMBER in this project
    await prisma.projectMember.create({
      data: { projectId, userId: memberId, role: 'MEMBER' },
    });
  });

  it('LEAD on the project can rename', async () => {
    const updated = await service.renameProject(
      projectId,
      { name: 'Renamed', description: 'new desc' },
      { id: leadId, role: 'LEAD' },
    );
    expect(updated.name).toBe('Renamed');
    expect(updated.description).toBe('new desc');
  });

  it('MEMBER (project) cannot rename', async () => {
    await expect(
      service.renameProject(projectId, { name: 'Nope' }, { id: memberId, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('global ADMIN (non-member) can rename', async () => {
    const updated = await service.renameProject(
      projectId,
      { name: 'AdminRenamed' },
      { id: adminId, role: 'ADMIN' },
    );
    expect(updated.name).toBe('AdminRenamed');
  });

  it('archived project remains renameable (decision: keep editable)', async () => {
    await service.archiveProject(projectId, { id: leadId, role: 'LEAD' });
    const updated = await service.renameProject(
      projectId,
      { name: 'Still editable' },
      { id: leadId, role: 'LEAD' },
    );
    expect(updated.name).toBe('Still editable');
  });
});
