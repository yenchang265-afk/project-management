// /search — global search page. Server component reading `searchParams`.
// Requires a `projectKey` param to scope FTS to one project. Filter chips on
// the sidebar drive the query.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSearchService } from '@/server/services/search';

export const dynamic = 'force-dynamic';

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
const PRIORITIES = ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST'] as const;
const TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'] as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof AuthError && err.code === 'unauthenticated') redirect('/login');
    throw err;
  }

  const sp = await searchParams;
  const projectKey = typeof sp.projectKey === 'string' ? sp.projectKey : '';
  const q = typeof sp.q === 'string' ? sp.q : '';
  const status = readArray(sp.status);
  const priority = readArray(sp.priority);
  const type = readArray(sp.type);

  let result: {
    data: Array<{ id: string; key: string; title: string; status: string }>;
    pageInfo: { hasMore: boolean };
  } = {
    data: [],
    pageInfo: { hasMore: false },
  };
  let error: string | null = null;
  if (projectKey) {
    try {
      const svc = createSearchService({ prisma });
      const r = await svc.searchIssues(
        {
          projectKey,
          q,
          filters: {
            status: status.length ? (status as never) : undefined,
            priority: priority.length ? (priority as never) : undefined,
            type: type.length ? (type as never) : undefined,
          },
          limit: 25,
        },
        { id: actor.id, role: actor.role },
      );
      result = r;
    } catch (err) {
      if (err instanceof AuthError) error = err.message;
      else throw err;
    }
  }

  return (
    <main className="mx-auto mt-8 grid max-w-6xl grid-cols-[16rem_1fr] gap-6 p-4">
      <aside>
        <h2 className="mb-2 text-lg font-semibold">Filters</h2>
        <form method="get" className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col">
            <span className="text-xs font-medium uppercase text-gray-600">Project key</span>
            <input
              type="text"
              name="projectKey"
              defaultValue={projectKey}
              required
              className="rounded border px-2 py-1"
              data-testid="search-project-key"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs font-medium uppercase text-gray-600">Query</span>
            <input
              type="text"
              name="q"
              defaultValue={q}
              className="rounded border px-2 py-1"
              data-testid="search-q"
            />
          </label>
          <fieldset>
            <legend className="text-xs font-medium uppercase text-gray-600">Status</legend>
            {STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="status"
                  value={s}
                  defaultChecked={status.includes(s)}
                />
                {s}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="text-xs font-medium uppercase text-gray-600">Priority</legend>
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
          </fieldset>
          <fieldset>
            <legend className="text-xs font-medium uppercase text-gray-600">Type</legend>
            {TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input type="checkbox" name="type" value={t} defaultChecked={type.includes(t)} />
                {t}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1 text-white"
            data-testid="search-submit"
          >
            Search
          </button>
        </form>
      </aside>
      <section>
        <h1 className="mb-3 text-2xl font-semibold">Search</h1>
        {error ? (
          <p className="mb-2 text-sm text-red-600" data-testid="search-error">
            {error}
          </p>
        ) : null}
        {projectKey ? (
          <ul className="divide-y rounded border" data-testid="search-results">
            {result.data.length === 0 ? (
              <li className="p-3 text-sm text-gray-500">No matches.</li>
            ) : (
              result.data.map((i) => (
                <li key={i.id} className="p-3 text-sm">
                  <Link
                    href={`/projects/${projectKey}/issues/${i.key}`}
                    className="hover:underline"
                  >
                    <span className="mr-2 font-mono text-xs text-gray-500">{i.key}</span>
                    {i.title}
                  </Link>
                </li>
              ))
            )}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">Enter a project key to begin.</p>
        )}
      </section>
    </main>
  );
}

function readArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
