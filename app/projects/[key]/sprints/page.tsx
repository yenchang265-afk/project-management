// /projects/[key]/sprints — list of sprints with state badges.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { hasRoleAtLeast } from '@/server/auth/roles';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';

export const dynamic = 'force-dynamic';

const STATE_STYLES: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-blue-100 text-blue-700',
};

export default async function SprintsListPage({ params }: { params: Promise<{ key: string }> }) {
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
  const { role, user } = access;

  const svc = createSprintsService({ prisma });
  const sprints = await svc.listSprints(key, { id: user.id, role: user.role });

  return (
    <main className="mx-auto mt-12 max-w-3xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          <span className="font-mono text-base text-gray-500">{key}</span> Sprints
        </h1>
        {hasRoleAtLeast(role, 'LEAD') ? (
          <Link
            href={`/projects/${key}/sprints/new`}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
            data-testid="plan-sprint-link"
          >
            Plan sprint
          </Link>
        ) : null}
      </header>

      <nav className="mb-4 text-sm">
        <Link className="text-blue-700 hover:underline" href={`/projects/${key}/active-sprint`}>
          View active sprint board →
        </Link>
      </nav>

      <ul className="divide-y rounded border" data-testid="sprints-list">
        {sprints.length === 0 ? (
          <li className="p-4 text-sm text-gray-500">No sprints yet.</li>
        ) : (
          sprints.map((s) => (
            <li key={s.id} className="flex items-center justify-between p-4 text-sm">
              <Link
                className="flex-1 hover:underline"
                href={`/projects/${key}/sprints/${s.id}`}
                data-testid={`sprint-${s.id}`}
              >
                <span className="font-medium">{s.name}</span>
                {s.goal ? <span className="ml-2 text-gray-600">— {s.goal}</span> : null}
              </Link>
              <span
                className={`rounded px-2 py-0.5 font-mono text-xs ${STATE_STYLES[s.state] ?? ''}`}
              >
                {s.state}
              </span>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
