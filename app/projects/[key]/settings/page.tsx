// /projects/[key]/settings — rename + archive. Guarded by requireProjectAccess(..., 'LEAD').

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { prisma } from '@/server/db';
import { createProjectsService } from '@/server/services/projects';

export const dynamic = 'force-dynamic';

async function renameAction(projectKey: string, formData: FormData): Promise<void> {
  'use server';
  const { project, user, role } = await requireProjectAccess(projectKey, 'LEAD');
  const svc = createProjectsService({ prisma });
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  await svc.renameProject(
    project.id,
    { name, description: description.length > 0 ? description : undefined },
    { id: user.id, role },
  );
  revalidatePath(`/projects/${projectKey}`);
  revalidatePath(`/projects/${projectKey}/settings`);
}

async function archiveAction(projectKey: string): Promise<void> {
  'use server';
  const { project, user, role } = await requireProjectAccess(projectKey, 'LEAD');
  const svc = createProjectsService({ prisma });
  await svc.archiveProject(project.id, { id: user.id, role });
  revalidatePath('/projects');
  redirect('/projects');
}

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  let access;
  try {
    access = await requireProjectAccess(key, 'LEAD');
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'unauthenticated') redirect('/login');
      if (err.code === 'not_found') notFound();
      if (err.code === 'forbidden') redirect(`/projects/${key}`);
    }
    throw err;
  }
  const { project } = access;

  const renameBound = renameAction.bind(null, key);
  const archiveBound = archiveAction.bind(null, key);

  return (
    <main className="mx-auto mt-12 max-w-md p-4">
      <h1 className="mb-4 text-2xl font-semibold">Project settings</h1>
      <p className="mb-4 text-sm text-gray-600">
        <span className="font-mono">{project.key}</span>
      </p>

      <form action={renameBound} className="mb-8 flex flex-col gap-3">
        <label className="flex flex-col text-sm">
          Name
          <input
            type="text"
            name="name"
            defaultValue={project.name}
            required
            className="rounded border p-2"
          />
        </label>
        <label className="flex flex-col text-sm">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={project.description ?? ''}
            className="rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded bg-black p-2 text-white">
          Save changes
        </button>
      </form>

      {project.archivedAt ? (
        <p className="text-sm text-gray-600">
          This project is archived ({project.archivedAt.toISOString().slice(0, 10)}). Unarchiving is
          not yet supported.
        </p>
      ) : (
        <form action={archiveBound}>
          <button
            type="submit"
            className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
            data-testid="archive-project-button"
          >
            Archive this project
          </button>
        </form>
      )}
    </main>
  );
}
