// /projects/[key]/issues/[issueKey] — issue detail (server component).
// Fetches via getIssue, hands the composed snapshot to a small client island
// for transition/comments/links interactions.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { hasRoleAtLeast } from '@/server/auth/roles';
import { prisma } from '@/server/db';
import { createIssuesService } from '@/server/services/issues';

import { IssueClient } from './issue-client';

export const dynamic = 'force-dynamic';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ key: string; issueKey: string }>;
}) {
  const { key, issueKey } = await params;
  try {
    await requireProjectAccess(key, 'VIEWER');
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'unauthenticated') redirect('/login');
      if (err.code === 'not_found') notFound();
      if (err.code === 'forbidden') redirect('/projects');
    }
    throw err;
  }

  const session = await requireProjectAccess(key, 'VIEWER');
  const svc = createIssuesService({ prisma });
  let composed;
  try {
    composed = await svc.getIssue(issueKey, { id: session.user.id, role: session.user.role });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'not_found') notFound();
    throw err;
  }

  const canEdit = hasRoleAtLeast(session.role, 'MEMBER');

  return (
    <main className="mx-auto mt-12 max-w-3xl p-4">
      <div className="mb-4 text-sm">
        <Link href={`/projects/${key}`} className="text-blue-600 hover:underline">
          ← {key}
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="issue-title">
          <span className="mr-2 font-mono text-base text-gray-500">{composed.key}</span>
          {composed.title}
        </h1>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-gray-600">Status</dt>
          <dd data-testid="issue-status">{composed.status}</dd>
          <dt className="text-gray-600">Type</dt>
          <dd>{composed.type}</dd>
          <dt className="text-gray-600">Priority</dt>
          <dd>{composed.priority}</dd>
          <dt className="text-gray-600">Reporter</dt>
          <dd>{composed.reporterId}</dd>
          <dt className="text-gray-600">Assignee</dt>
          <dd>{composed.assigneeId ?? '—'}</dd>
          {composed.labels.length > 0 ? (
            <>
              <dt className="text-gray-600">Labels</dt>
              <dd>{composed.labels.map((l) => l.name).join(', ')}</dd>
            </>
          ) : null}
        </dl>
      </header>

      {composed.description ? (
        <section className="mb-6 whitespace-pre-wrap rounded border bg-gray-50 p-4 text-sm">
          {composed.description}
        </section>
      ) : null}

      <IssueClient
        issueKey={composed.key}
        projectKey={key}
        status={composed.status}
        canEdit={canEdit}
        initialComments={composed.comments.map((c) => ({
          id: c.id,
          authorId: c.authorId,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        }))}
        attachments={composed.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          uploaderId: a.uploaderId,
          size: a.size,
        }))}
        links={composed.links.map((l) => ({
          id: l.id,
          type: l.type,
          direction: l.direction,
          fromIssueId: l.fromIssueId,
          toIssueId: l.toIssueId,
        }))}
        activity={composed.activity.map((a) => ({
          id: a.id,
          actorId: a.actorId,
          field: a.field,
          before: a.before,
          after: a.after,
          at: a.at.toISOString(),
        }))}
      />
    </main>
  );
}
