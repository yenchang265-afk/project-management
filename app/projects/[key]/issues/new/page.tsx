// /projects/[key]/issues/new — minimal page-based form (no modal for MVP).
// On submit posts to /api/projects/[key]/issues and redirects to detail.

import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';

import { NewIssueForm } from './form-client';

export const dynamic = 'force-dynamic';

export default async function NewIssuePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    await requireProjectAccess(key, 'MEMBER');
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'unauthenticated') redirect('/login');
      if (err.code === 'not_found') notFound();
      if (err.code === 'forbidden') redirect('/projects');
    }
    throw err;
  }

  return (
    <main className="mx-auto mt-12 max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">New issue in {key}</h1>
      <NewIssueForm projectKey={key} />
    </main>
  );
}
