// Profile page. Protected by requireUser(). Lets the user edit their name.
// TODO: avatar upload — deferred until MinIO integration lands.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { AuthError } from '@/lib/errors';
import { requireUser } from '@/server/auth/guards';
import { signOut } from '@/server/auth';
import { prisma } from '@/server/db';

async function updateName(formData: FormData): Promise<void> {
  'use server';
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  revalidatePath('/profile');
}

async function logoutAction(): Promise<void> {
  'use server';
  await signOut({ redirect: false });
  redirect('/login');
}

export default async function ProfilePage() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError && err.code === 'unauthenticated') {
      redirect('/login');
    }
    throw err;
  }

  // Re-read from the DB so the page reflects the most recent name edits.
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  const membership = await prisma.orgMembership.findUnique({ where: { userId: user.id } });
  const role = membership?.role ?? 'MEMBER';

  return (
    <main className="mx-auto mt-16 max-w-md p-4">
      <h1 className="mb-4 text-2xl font-semibold">Your profile</h1>
      <dl className="mb-6 grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="font-medium text-gray-600">Email</dt>
        <dd data-testid="profile-email">{fresh?.email}</dd>
        <dt className="font-medium text-gray-600">Role</dt>
        <dd data-testid="profile-role">{role}</dd>
      </dl>

      <form action={updateName} className="mb-6 flex flex-col gap-3">
        <label className="flex flex-col text-sm">
          Name
          <input
            type="text"
            name="name"
            defaultValue={fresh?.name ?? ''}
            required
            className="rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded bg-black p-2 text-white">
          Save
        </button>
      </form>

      <form action={logoutAction}>
        <button type="submit" className="rounded border p-2">
          Sign out
        </button>
      </form>
    </main>
  );
}
