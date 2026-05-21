import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePrisma, type FakePrisma } from './fakePrisma';
import { createProjectsService } from '@/server/services/projects';

describe('projects.nextIssueNumber', () => {
  let prisma: FakePrisma;
  let service: ReturnType<typeof createProjectsService>;
  let projectId: string;

  beforeEach(async () => {
    prisma = createFakePrisma();
    service = createProjectsService({ prisma: prisma as never });
    const lead = await prisma.user.create({ data: { email: 'l@e.com', name: 'L' } });
    await prisma.orgMembership.create({ data: { userId: lead.id, role: 'LEAD' } });
    const p = await service.createProject(
      { key: 'CTR', name: 'C', leadId: lead.id },
      { id: lead.id, role: 'LEAD' },
    );
    projectId = p.id;
  });

  it('increments sequentially within a transaction', async () => {
    const n1 = await prisma.$transaction((tx) => service.nextIssueNumber(projectId, tx as never));
    const n2 = await prisma.$transaction((tx) => service.nextIssueNumber(projectId, tx as never));
    const n3 = await prisma.$transaction((tx) => service.nextIssueNumber(projectId, tx as never));
    expect([n1, n2, n3]).toEqual([1, 2, 3]);
  });

  it('serial sequence of 10 calls is monotonic', async () => {
    const got: number[] = [];
    for (let i = 0; i < 10; i++) {
      got.push(await prisma.$transaction((tx) => service.nextIssueNumber(projectId, tx as never)));
    }
    expect(got).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
