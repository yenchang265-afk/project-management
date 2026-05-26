// Shared bootstrap for Phase 5a (Audit) integration tests.
// Mirrors the Phase 2/3 pattern: each spec creates its own container; specs
// are skipped when DOCKER_AVAILABLE is unset.

import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { vi } from 'vitest';

export type AuditIntegrationContext = {
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
};

export async function startAuditIntegrationContext(): Promise<AuditIntegrationContext> {
  const container = await new PostgreSqlContainer('postgres:16').start();
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
  process.env.SMTP_HOST ??= 'localhost';
  process.env.SMTP_PORT ??= '1025';
  process.env.NEXTAUTH_URL ??= 'http://localhost:3000';

  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  return { container, databaseUrl };
}

export async function stopAuditIntegrationContext(ctx: AuditIntegrationContext | undefined) {
  await ctx?.container?.stop();
}

/** Register an org user and return their id. */
export async function registerUser(email: string): Promise<string> {
  const { POST: register } = await import('@/../app/api/auth/register/route');
  const res = await register(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password-1234', name: email.split('@')[0] }),
    }),
  );
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** Bump a user to a specific role in OrgMembership (creating the row if absent). */
export async function setOrgRole(userId: string, role: 'ADMIN' | 'LEAD' | 'MEMBER' | 'VIEWER') {
  const { prisma } = await import('@/server/db');
  await prisma.orgMembership.upsert({
    where: { userId },
    update: { role },
    create: { userId, role },
  });
}

/** Wrap a request-handler test with a mocked auth session. */
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
