// Race-free issue counter check: 20 concurrent transactions should each
// return a unique sequential number with no collisions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startProjectsIntegrationContext,
  stopProjectsIntegrationContext,
  type ProjectsIntegrationContext,
} from './setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('nextIssueNumber concurrency', () => {
  let ctx: ProjectsIntegrationContext;
  let projectId: string;

  beforeAll(async () => {
    ctx = await startProjectsIntegrationContext();
    const { POST: register } = await import('@/../app/api/auth/register/route');
    const leadRes = await register(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ctr@e.com', password: 'pass-1234', name: 'Ctr' }),
      }),
    );
    const leadId = ((await leadRes.json()) as { id: string }).id;
    const { prisma } = await import('@/server/db');
    await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });
    const { createProjectsService } = await import('@/server/services/projects');
    const svc = createProjectsService({ prisma });
    const p = await svc.createProject(
      { key: 'CTRINT', name: 'C', leadId },
      { id: leadId, role: 'LEAD' },
    );
    projectId = p.id;
  }, 180_000);

  afterAll(async () => {
    await stopProjectsIntegrationContext(ctx);
  });

  it('20 concurrent calls return unique sequential numbers', async () => {
    const { prisma } = await import('@/server/db');
    const { createProjectsService } = await import('@/server/services/projects');
    const svc = createProjectsService({ prisma });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => svc.nextIssueNumber(projectId, tx as never)),
      ),
    );
    const sorted = [...results].sort((a, b) => a - b);
    expect(new Set(results).size).toBe(20);
    expect(sorted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
