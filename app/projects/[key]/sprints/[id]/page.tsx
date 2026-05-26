// /projects/[key]/sprints/[id] — sprint detail. Lists issues + add/remove +
// start/complete actions for LEAD.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { hasRoleAtLeast } from '@/server/auth/roles';
import { prisma } from '@/server/db';

import { SprintActions } from './actions-client';
import { BacklogPickerClient } from './picker-client';

export const dynamic = 'force-dynamic';

const STATE_STYLES: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-blue-100 text-blue-700',
};

export default async function SprintDetailPage({
  params,
}: {
  params: Promise<{ key: string; id: string }>;
}) {
  const { key, id } = await params;
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
  const { role, project } = access;

  const sprint = await prisma.sprint.findUnique({ where: { id } });
  if (!sprint || sprint.projectId !== project.id) notFound();

  const links = await prisma.sprintIssue.findMany({
    where: { sprintId: sprint.id },
    orderBy: { rank: 'asc' },
  });
  const ids = links.map((l) => l.issueId);
  const issues = ids.length ? await prisma.issue.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(issues.map((i) => [i.id, i]));
  const ordered = links
    .map((l) => byId.get(l.issueId))
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  // Backlog issues (project-wide issues not yet in any sprint of this project)
  // for the picker. Cheap: pull all issues and exclude those already linked.
  const allProjectIssues = await prisma.issue.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const linkedIds = new Set(ids);
  const linkedAnywhere = await prisma.sprintIssue.findMany({
    where: { sprint: { projectId: project.id } },
  });
  for (const l of linkedAnywhere) linkedIds.add(l.issueId);
  const backlog = allProjectIssues.filter((i) => !linkedIds.has(i.id));

  const canManage = hasRoleAtLeast(role, 'MEMBER');
  const canLead = hasRoleAtLeast(role, 'LEAD');

  return (
    <main className="mx-auto mt-12 max-w-3xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{sprint.name}</h1>
          {sprint.goal ? <p className="text-sm text-gray-600">{sprint.goal}</p> : null}
        </div>
        <span
          className={`rounded px-2 py-1 font-mono text-xs ${STATE_STYLES[sprint.state] ?? ''}`}
          data-testid="sprint-state"
        >
          {sprint.state}
        </span>
      </header>

      <nav className="mb-4 text-sm">
        <Link className="text-blue-700 hover:underline" href={`/projects/${key}/sprints`}>
          ← All sprints
        </Link>
      </nav>

      {canLead ? (
        <section className="mb-6">
          <SprintActions sprintId={sprint.id} state={sprint.state} projectKey={key} />
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Issues in sprint</h2>
        <ul className="divide-y rounded border" data-testid="sprint-issues">
          {ordered.length === 0 ? (
            <li className="p-3 text-sm text-gray-500">No issues in this sprint.</li>
          ) : (
            ordered.map((i) => (
              <li key={i.id} className="flex items-center justify-between p-3 text-sm">
                <Link className="flex-1 hover:underline" href={`/projects/${key}/issues/${i.key}`}>
                  <span className="mr-2 font-mono text-xs text-gray-500">{i.key}</span>
                  {i.title}
                </Link>
                <span className="font-mono text-xs text-gray-500">{i.status}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      {canManage && sprint.state !== 'COMPLETED' && backlog.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-medium">Add from backlog</h2>
          <BacklogPickerClient
            sprintId={sprint.id}
            options={backlog.map((b) => ({ key: b.key, title: b.title }))}
          />
        </section>
      ) : null}
    </main>
  );
}
