// /projects/[key]/backlog — TODO issues with filter chips + sort.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { prisma } from '@/server/db';
import { createBoardsService } from '@/server/services/boards';

import { SavedFiltersDropdown } from '../saved-filters-dropdown';

export const dynamic = 'force-dynamic';

const PRIORITIES = ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST'] as const;
const TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'] as const;

export default async function BacklogPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
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

  const priority = readArray(sp.priority).filter((p) =>
    (PRIORITIES as readonly string[]).includes(p),
  );
  const type = readArray(sp.type).filter((t) => (TYPES as readonly string[]).includes(t));

  const svc = createBoardsService({ prisma });
  const result = await svc.getBacklog(
    {
      projectKey: key,
      filters: {
        priority: priority.length ? (priority as never) : undefined,
        type: type.length ? (type as never) : undefined,
      },
      limit: 50,
    },
    { id: access.user.id, role: access.user.role },
  );

  return (
    <main className="mx-auto mt-8 max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          <span className="font-mono text-base text-gray-500">{key}</span> Backlog
        </h1>
        <SavedFiltersDropdown projectId={access.project.id} />
      </header>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Priority:</span>
        {PRIORITIES.map((p) => (
          <label key={p} className="flex items-center gap-1">
            <input
              type="checkbox"
              name="priority"
              value={p}
              defaultChecked={priority.includes(p)}
            />
            {p}
          </label>
        ))}
        <span className="ml-4 font-medium">Type:</span>
        {TYPES.map((t) => (
          <label key={t} className="flex items-center gap-1">
            <input type="checkbox" name="type" value={t} defaultChecked={type.includes(t)} />
            {t}
          </label>
        ))}
        <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">
          Apply
        </button>
      </form>

      <ul className="divide-y rounded border" data-testid="backlog-list">
        {result.data.length === 0 ? (
          <li className="p-3 text-sm text-gray-500">Backlog is empty.</li>
        ) : (
          result.data.map((i) => (
            <li key={i.id} className="flex items-center justify-between p-3 text-sm">
              <Link
                href={`/projects/${key}/issues/${i.key}`}
                className="flex-1 hover:underline"
                data-testid={`backlog-item-${i.key}`}
              >
                <span className="mr-2 font-mono text-xs text-gray-500">{i.key}</span>
                {i.title}
              </Link>
              <span className="font-mono text-xs text-gray-500">{i.priority}</span>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}

function readArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
