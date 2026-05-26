// /dashboard — Phase 4d home page. Server component, three sections.
//
// All data is fetched in one shot from the dashboard service so the page
// shows a consistent snapshot. RBAC + visibility live in the service.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createDashboardService, type RecentActivityEntry } from '@/server/services/dashboard';

export const dynamic = 'force-dynamic';

function projectKeyFromIssueKey(issueKey: string): string {
  const idx = issueKey.lastIndexOf('-');
  return idx > 0 ? issueKey.slice(0, idx) : issueKey;
}

function relativeTime(at: Date): string {
  const ms = Date.now() - at.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function describeActivity(entry: RecentActivityEntry): string {
  // Friendly summary of what changed. Falls back to the raw field name when
  // we don't have a tailored phrasing.
  switch (entry.field) {
    case 'created':
      return 'created the issue';
    case 'status':
      return `moved status ${entry.before ?? '∅'} → ${entry.after ?? '∅'}`;
    case 'comment.added':
      return 'added a comment';
    case 'link.added':
      return `linked to ${entry.after ?? 'another issue'}`;
    case 'link.removed':
      return 'removed a link';
    case 'attachment.added':
      return `attached ${entry.after ?? 'a file'}`;
    case 'attachment.removed':
      return 'removed an attachment';
    case 'title':
      return 'renamed the issue';
    case 'priority':
      return `set priority to ${entry.after ?? '∅'}`;
    case 'assigneeId':
      return entry.after ? 'changed assignee' : 'unassigned';
    case 'dueDate':
      return entry.after ? 'updated due date' : 'cleared due date';
    default:
      return `updated ${entry.field}`;
  }
}

export default async function DashboardPage() {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof AuthError && err.code === 'unauthenticated') redirect('/login');
    throw err;
  }

  const svc = createDashboardService({ prisma });
  const { assignedToMe, recentActivity, projectTiles } = await svc.getDashboardData({
    id: actor.id,
    role: actor.role,
  });

  return (
    <main className="mx-auto mt-8 max-w-6xl p-4">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-gray-600" data-testid="dashboard-greeting">
          Signed in as {actor.name ?? actor.email}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section aria-labelledby="assigned-heading" data-testid="assigned-to-me">
          <h2 id="assigned-heading" className="mb-3 text-lg font-medium">
            Assigned to me
          </h2>
          {assignedToMe.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing assigned. Enjoy the calm.</p>
          ) : (
            <ul className="divide-y rounded border">
              {assignedToMe.map((i) => {
                const projectKey = projectKeyFromIssueKey(i.key);
                return (
                  <li key={i.id} className="p-3 text-sm">
                    <Link
                      href={`/projects/${projectKey}/issues/${i.key}`}
                      className="block hover:underline"
                      data-testid={`assigned-issue-${i.key}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate font-medium">{i.title}</span>
                        <span className="ml-2 font-mono text-xs text-gray-500">{i.key}</span>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-gray-600">
                        <span aria-label="priority">{i.priority}</span>
                        <span aria-label="status">{i.status}</span>
                        {i.dueDate ? (
                          <span aria-label="due date">
                            due {i.dueDate.toISOString().slice(0, 10)}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity-heading" data-testid="recent-activity">
          <h2 id="activity-heading" className="mb-3 text-lg font-medium">
            Recent activity
          </h2>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-gray-500">No activity yet.</p>
          ) : (
            <ol className="divide-y rounded border">
              {recentActivity.map((entry) => {
                const projectKey = projectKeyFromIssueKey(entry.issueKey);
                return (
                  <li key={entry.id} className="p-3 text-sm">
                    <p>
                      <span className="font-medium">{entry.actorName ?? 'Someone'}</span>{' '}
                      <span className="text-gray-700">{describeActivity(entry)}</span>{' '}
                      <span className="text-gray-500">on</span>{' '}
                      <Link
                        href={`/projects/${projectKey}/issues/${entry.issueKey}`}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        {entry.issueKey}
                      </Link>
                    </p>
                    <time dateTime={entry.at.toISOString()} className="text-xs text-gray-500">
                      {relativeTime(entry.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="projects-heading" data-testid="project-tiles">
          <h2 id="projects-heading" className="mb-3 text-lg font-medium">
            Projects
          </h2>
          {projectTiles.length === 0 ? (
            <p className="text-sm text-gray-500">You aren&apos;t a member of any projects yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3">
              {projectTiles.map((tile) => (
                <li key={tile.id}>
                  <Link
                    href={`/projects/${tile.key}`}
                    className="block rounded border p-3 text-sm hover:bg-gray-50"
                    data-testid={`project-tile-${tile.key}`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">{tile.name}</span>
                      <span className="font-mono text-xs text-gray-500">{tile.key}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">Lead: {tile.leadName ?? '—'}</div>
                    <dl className="mt-2 flex gap-4 text-xs">
                      <div>
                        <dt className="inline text-gray-500">Open: </dt>
                        <dd className="inline font-semibold" data-testid={`open-${tile.key}`}>
                          {tile.openIssues}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-500">Done this week: </dt>
                        <dd className="inline font-semibold" data-testid={`done-week-${tile.key}`}>
                          {tile.doneThisWeek}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
