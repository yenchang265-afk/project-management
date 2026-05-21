// Shared bootstrap for Phase 3 (Issues) integration tests.
// Mirrors the Phase 2 pattern. Each spec creates its own container; specs are
// gated on DOCKER_AVAILABLE so the suite stays loadable in sandboxes without
// a Docker daemon.

import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { vi } from 'vitest';

export type IssuesIntegrationContext = {
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
};

export async function startIssuesIntegrationContext(): Promise<IssuesIntegrationContext> {
  const container = await new PostgreSqlContainer('postgres:16').start();
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
  process.env.SMTP_HOST ??= 'localhost';
  process.env.SMTP_PORT ??= '1025';
  process.env.NEXTAUTH_URL ??= 'http://localhost:3000';
  // S3 stub-mode: tests inject a client via __setS3ClientForTesting, so these
  // never actually hit S3 — but we set the env so any code path that reads
  // them doesn't blow up.
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

export async function stopIssuesIntegrationContext(ctx: IssuesIntegrationContext | undefined) {
  await ctx?.container?.stop();
}

export type TestUsers = {
  leadId: string;
  memberId: string;
  outsiderId: string;
  projectKey: string;
};

export async function seedUsersAndProject(projectKey = 'IPHA'): Promise<TestUsers> {
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

  // Use the projects service via API to keep RBAC consistent
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

  // Add member to project (ProjectMember row)
  const { prisma: prisma2 } = await import('@/server/db');
  const project = await prisma2.project.findUnique({ where: { key: projectKey } });
  if (!project) throw new Error('project missing');
  await prisma2.projectMember.create({
    data: { projectId: project.id, userId: memberId, role: 'MEMBER' },
  });

  return { leadId, memberId, outsiderId, projectKey };
}

/**
 * Wrap a request-handler test with a mocked auth session for the given user.
 * Re-imports the route handler under the mock so the dynamic auth() call uses
 * our session stub.
 */
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
