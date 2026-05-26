// Shared bootstrap for Phase 2 (Projects) integration tests. Mirrors the
// Phase 1 pattern in tests/integration/auth/setup.ts.

import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export type ProjectsIntegrationContext = {
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
};

export async function startProjectsIntegrationContext(): Promise<ProjectsIntegrationContext> {
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

export async function stopProjectsIntegrationContext(ctx: ProjectsIntegrationContext | undefined) {
  await ctx?.container?.stop();
}
