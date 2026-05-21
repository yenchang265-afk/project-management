// /projects/[key]/sprints/new — minimal LEAD-only form to plan a sprint.

import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';

import { NewSprintForm } from './form-client';

export const dynamic = 'force-dynamic';

export default async function NewSprintPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    await requireProjectAccess(key, 'LEAD');
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'unauthenticated') redirect('/login');
      if (err.code === 'not_found') notFound();
      if (err.code === 'forbidden') redirect(`/projects/${key}/sprints`);
    }
    throw err;
  }

  return (
    <main className="mx-auto mt-12 max-w-xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Plan sprint in {key}</h1>
      <NewSprintForm projectKey={key} />
    </main>
  );
}
