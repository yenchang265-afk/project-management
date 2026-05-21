// Asserts the partial unique index `active_sprint_per_project` blocks two
// ACTIVE sprints in the same project at the DB level.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedUsersAndProject,
  startSprintsIntegrationContext,
  stopSprintsIntegrationContext,
  type SprintsIntegrationContext,
  type TestUsers,
} from './__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('partial unique index: one ACTIVE sprint per project', () => {
  let ctx: SprintsIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startSprintsIntegrationContext();
    u = await seedUsersAndProject('SPNX');
  }, 240_000);

  afterAll(async () => {
    await stopSprintsIntegrationContext(ctx);
  });

  it('a second sprint cannot be inserted with state=ACTIVE via raw SQL', async () => {
    const { prisma } = await import('@/server/db');
    const project = await prisma.project.findUnique({ where: { key: u.projectKey } });
    if (!project) throw new Error('project missing');

    // Insert one ACTIVE sprint directly.
    await prisma.sprint.create({
      data: { projectId: project.id, name: 'A', state: 'ACTIVE', startDate: new Date() },
    });

    // Inserting a second ACTIVE sprint must fail at the DB level.
    await expect(
      prisma.sprint.create({
        data: { projectId: project.id, name: 'B', state: 'ACTIVE', startDate: new Date() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
