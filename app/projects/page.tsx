// /projects — list of accessible projects. Archived toggle for LEAD+.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireUser } from '@/server/auth/guards';
import { hasRoleAtLeast } from '@/server/auth/roles';
import { prisma } from '@/server/db';
import { createProjectsService } from '@/server/services/projects';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ includeArchived?: string }>;

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof AuthError && err.code === 'unauthenticated') redirect('/login');
    throw err;
  }
  const params = await searchParams;
  const wantsArchived = params.includeArchived === 'true';
  const canSeeArchived = hasRoleAtLeast(actor.role, 'LEAD');
  const includeArchived = wantsArchived && canSeeArchived;

  const svc = createProjectsService({ prisma });
  const projects = await svc.listProjects({ id: actor.id, role: actor.role }, { includeArchived });

  return (
    <main className="mx-auto mt-12 max-w-2xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {hasRoleAtLeast(actor.role, 'LEAD') ? (
          <Link
            href="/projects/new"
            className="rounded bg-black px-3 py-2 text-sm text-white"
            data-testid="new-project-link"
          >
            New project
          </Link>
        ) : null}
      </header>

      {canSeeArchived ? (
        <p className="mb-4 text-sm">
          {includeArchived ? (
            <Link href="/projects" className="underline">
              Hide archived
            </Link>
          ) : (
            <Link href="/projects?includeArchived=true" className="underline">
              Show archived
            </Link>
          )}
        </p>
      ) : null}

      {projects.length === 0 ? (
        <p className="text-sm text-gray-600">No projects yet.</p>
      ) : (
        <ul className="divide-y rounded border">
          {projects.map((p) => (
            <li key={p.id} className="p-3">
              <Link
                href={`/projects/${p.key}`}
                className="flex justify-between"
                data-testid={`project-row-${p.key}`}
              >
                <span>
                  <span className="font-mono text-xs text-gray-500">{p.key}</span>{' '}
                  <span className="font-medium">{p.name}</span>
                </span>
                {p.archivedAt ? (
                  <span className="text-xs uppercase text-gray-500">archived</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
