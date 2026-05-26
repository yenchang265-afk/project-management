import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { createProjectsService } from '@/server/services/projects';

describe('projects.archiveProject', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createProjectsService>;
  let leadId: string;
  let projectId: string;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createProjectsService({ prisma: prisma as never });
    const lead = await prisma.user.create({ data: { email: 'l@e.com', name: 'L' } });
    leadId = lead.id;
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });
    const p = await service.createProject(
      { key: 'ARC', name: 'A', leadId },
      { id: leadId, role: 'LEAD' },
    );
    projectId = p.id;
  });

  it('sets archivedAt on the project', async () => {
    const result = await service.archiveProject(projectId, { id: leadId, role: 'LEAD' });
    expect(result.archivedAt).toBeInstanceOf(Date);
  });

  it('is idempotent (re-archiving keeps the original timestamp)', async () => {
    const first = await service.archiveProject(projectId, { id: leadId, role: 'LEAD' });
    const firstAt = first.archivedAt!.getTime();
    await new Promise((r) => setTimeout(r, 5));
    const second = await service.archiveProject(projectId, { id: leadId, role: 'LEAD' });
    expect(second.archivedAt!.getTime()).toBe(firstAt);
  });
});
