// /projects/[key]/active-sprint — RSC. Active sprint board (columns by status)
// scoped to the sprint's issues, plus an inline SVG burndown chart.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';

import { Burndown } from './burndown';

export const dynamic = 'force-dynamic';

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;

export default async function ActiveSprintPage({ params }: { params: Promise<{ key: string }> }) {
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
  const { user } = access;

  const svc = createSprintsService({ prisma });
  const active = await svc.getActiveSprint(key, { id: user.id, role: user.role });

  if (!active) {
    return (
      <main className="mx-auto mt-12 max-w-3xl p-4">
        <h1 className="mb-3 text-2xl font-semibold">Active sprint</h1>
        <p className="text-gray-600">
          No sprint is currently active.{' '}
          <Link className="text-blue-700 hover:underline" href={`/projects/${key}/sprints`}>
            Plan one →
          </Link>
        </p>
      </main>
    );
  }

  const { sprint, columns } = active;
  const series = await svc.getBurndown(sprint.id, { id: user.id, role: user.role });

  return (
    <main className="mx-auto mt-12 max-w-6xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            <span className="font-mono text-base text-gray-500">{key}</span> {sprint.name}
          </h1>
          {sprint.goal ? <p className="text-sm text-gray-600">{sprint.goal}</p> : null}
        </div>
        <Link
          className="text-sm text-blue-700 hover:underline"
          href={`/projects/${key}/sprints/${sprint.id}`}
        >
          Sprint detail →
        </Link>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Burndown</h2>
        <Burndown series={series} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4" data-testid="active-sprint-board">
        {STATUSES.map((s) => (
          <div key={s} className="rounded border bg-gray-50">
            <h3 className="border-b p-2 text-sm font-medium text-gray-700">
              {s.replace('_', ' ')}
              <span className="ml-2 text-xs text-gray-500">({columns[s].length})</span>
            </h3>
            <ul className="space-y-2 p-2" data-testid={`sprint-col-${s}`}>
              {columns[s].map((i) => (
                <li key={i.id} className="rounded border bg-white p-2 text-sm shadow-sm">
                  <Link className="hover:underline" href={`/projects/${key}/issues/${i.key}`}>
                    <span className="mr-2 font-mono text-xs text-gray-500">{i.key}</span>
                    {i.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
