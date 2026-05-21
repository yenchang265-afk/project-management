// Shared bootstrap for Phase 4b (Sprints) integration tests.
// Same pattern as the Phase 3 (Issues) integration harness.

import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { vi } from 'vitest';

export type SprintsIntegrationContext = {
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
};

export async function startSprintsIntegrationContext(): Promise<SprintsIntegrationContext> {
  const container = await new PostgreSqlContainer('postgres:16').start();
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
  process.env.SMTP_HOST ??= 'localhost';
  process.env.SMTP_PORT ??= '1025';
  process.env.NEXTAUTH_URL ??= 'http://localhost:3000';
  process.env.S3_ENDPOINT ??= 'http://localhost:9000';
  process.env.S3_ACCESS_KEY ??= 'test';
  process.env.S3_SECRET_KEY ??= 'test';
  process.env.S3_BUCKET ??= 'test';

  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  return { container, databaseUrl };
}

export async function stopSprintsIntegrationContext(ctx: SprintsIntegrationContext | undefined) {
  await ctx?.container?.stop();
}

export type TestUsers = {
  leadId: string;
  memberId: string;
  outsiderId: string;
  projectKey: string;
};

export async function seedUsersAndProject(projectKey = 'SPN'): Promise<TestUsers> {
  const { POST: register } = await import('@/../app/api/auth/register/route');
  async function reg(email: string): Promise<string> {
    const r = await register(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password-1234', name: email.split('@')[0] }),
      }),
    );
    if (!r.ok) throw new Error(`register failed: ${r.status}`);
    return ((await r.json()) as { id: string }).id;
  }
  const leadId = await reg(`lead.${projectKey.toLowerCase()}@example.com`);
  const memberId = await reg(`member.${projectKey.toLowerCase()}@example.com`);
  const outsiderId = await reg(`outsider.${projectKey.toLowerCase()}@example.com`);
  const { prisma } = await import('@/server/db');
  await prisma.orgMembership.create({ data: { userId: leadId, role: 'LEAD' } });
  await prisma.orgMembership.create({ data: { userId: memberId, role: 'MEMBER' } });
  await prisma.orgMembership.create({ data: { userId: outsiderId, role: 'MEMBER' } });

  vi.doMock('@/server/auth', () => ({
    auth: vi.fn().mockResolvedValue({ user: { id: leadId, email: 'lead@x', name: 'Lead' } }),
  }));
  vi.resetModules();
  const { POST: createProject } = await import('@/../app/api/projects/route');
  const cres = await createProject(
    new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: projectKey, name: projectKey, leadId }),
    }),
  );
  if (!cres.ok) throw new Error(`createProject failed: ${cres.status}`);
  vi.doUnmock('@/server/auth');
  vi.resetModules();

  const { prisma: prisma2 } = await import('@/server/db');
  const project = await prisma2.project.findUnique({ where: { key: projectKey } });
  if (!project) throw new Error('project missing');
  await prisma2.projectMember.create({
    data: { projectId: project.id, userId: memberId, role: 'MEMBER' },
  });

  return { leadId, memberId, outsiderId, projectKey };
}

export async function withSession<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  vi.doMock('@/server/auth', () => ({
    auth: vi
      .fn()
      .mockResolvedValue(userId ? { user: { id: userId, email: 'x@x', name: 'X' } } : null),
  }));
  vi.resetModules();
  try {
    return await fn();
  } finally {
    vi.doUnmock('@/server/auth');
    vi.resetModules();
  }
}
