// /projects/[key] — project detail. Header + members list.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { hasRoleAtLeast } from '@/server/auth/roles';
import { prisma } from '@/server/db';
import { createProjectsService } from '@/server/services/projects';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let access;
  try {
    access = await requireProjectAccess(key, 'VIEWER');
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'unauthenticated') redirect('/login');
      if (err.code === 'not_found') notFound();
      if (err.code === 'forbidden') redirect('/projects');
    }
    throw err;
  }
  const { project, role } = access;

  const svc = createProjectsService({ prisma });
  const memberRows = await svc.listMembers(project.id);
  const userIds = memberRows.map((m) => m.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const lead = await prisma.user.findUnique({ where: { id: project.leadId } });

  return (
    <main className="mx-auto mt-12 max-w-2xl p-4">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            <span className="font-mono text-base text-gray-500">{project.key}</span> {project.name}
          </h1>
          {hasRoleAtLeast(role, 'LEAD') ? (
            <Link
              href={`/projects/${project.key}/settings`}
              className="rounded border px-3 py-2 text-sm"
              data-testid="project-settings-link"
            >
              Settings
            </Link>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-gray-600">Lead</dt>
          <dd>{lead?.name ?? lead?.email ?? '—'}</dd>
          <dt className="text-gray-600">Your role</dt>
          <dd data-testid="viewer-role">{role}</dd>
          {project.archivedAt ? (
            <>
              <dt className="text-gray-600">Archived</dt>
              <dd>{project.archivedAt.toISOString().slice(0, 10)}</dd>
            </>
          ) : null}
          {project.description ? (
            <>
              <dt className="text-gray-600">Description</dt>
              <dd>{project.description}</dd>
            </>
          ) : null}
        </dl>
      </header>

      <section>
        <h2 className="mb-2 text-lg font-medium">Members</h2>
        <ul className="divide-y rounded border">
          {memberRows.map((m) => {
            const u = userById.get(m.userId);
            return (
              <li key={m.id} className="flex justify-between p-3 text-sm">
                <span>{u?.name ?? u?.email ?? m.userId}</span>
                <span className="font-mono text-xs text-gray-500">{m.role}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
