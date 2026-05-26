import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { createProjectsService } from '@/server/services/projects';
import { AuthError } from '@/lib/errors';

describe('projects.createProject', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createProjectsService>;
  let leadId: string;
  let memberId: string;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createProjectsService({ prisma: prisma as never });
    const lead = await prisma.user.create({ data: { email: 'lead@e.com', name: 'Lead' } });
    leadId = lead.id;
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });
    const member = await prisma.user.create({ data: { email: 'm@e.com', name: 'Member' } });
    memberId = member.id;
    await prisma.orgMembership.create({ data: { userId: memberId, role: 'MEMBER' } });
  });

  it('creates a project (LEAD actor), auto-creates membership + IssueCounter', async () => {
    const project = await service.createProject(
      { key: 'ABC', name: 'Alpha', description: 'desc', leadId },
      { id: leadId, role: 'LEAD' },
    );

    expect(project.key).toBe('ABC');
    expect(project.name).toBe('Alpha');
    expect(project.leadId).toBe(leadId);

    // Auto ProjectMember row for the lead
    const member = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: leadId },
    });
    expect(member?.role).toBe('LEAD');

    // IssueCounter row created
    const counter = await prisma.issueCounter.findUnique({ where: { projectId: project.id } });
    expect(counter?.lastNumber).toBe(0);
  });

  it('rejects when actor is MEMBER (below LEAD)', async () => {
    await expect(
      service.createProject({ key: 'XYZ', name: 'X', leadId }, { id: memberId, role: 'MEMBER' }),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' });
  });

  it('rejects invalid key formats', async () => {
    const bad = ['ab', '1ABC', 'A', 'ABCDEFGHIJK', 'A-B', 'abc'];
    for (const key of bad) {
      await expect(
        service.createProject({ key, name: 'X', leadId }, { id: leadId, role: 'LEAD' }),
      ).rejects.toBeInstanceOf(AuthError);
    }
  });

  it('accepts edge-valid keys (2 chars min, 10 max, starts with a letter)', async () => {
    const ok = ['AB', 'A1', 'ABCDEFGHIJ'];
    for (const key of ok) {
      const p = await service.createProject(
        { key, name: key, leadId },
        { id: leadId, role: 'LEAD' },
      );
      expect(p.key).toBe(key);
    }
  });

  it('returns email_taken-style 409 on duplicate key', async () => {
    await service.createProject({ key: 'DUP', name: 'one', leadId }, { id: leadId, role: 'LEAD' });
    await expect(
      service.createProject({ key: 'DUP', name: 'two', leadId }, { id: leadId, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'duplicate_key' });
  });
});
