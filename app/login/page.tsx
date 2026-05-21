// Login page. Server action posts to the Credentials provider via Auth.js's
// signIn() helper, then redirects on success.

import { redirect } from 'next/navigation';
import { AuthError as NextAuthError } from 'next-auth';

import { signIn } from '@/server/auth';

async function loginAction(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email, password, redirect: false });
  } catch (err) {
    if (err instanceof NextAuthError) {
      redirect(`/login?error=${encodeURIComponent(err.type)}`);
    }
    throw err;
  }
  redirect('/profile');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-semibold">Sign in</h1>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
        >
          Invalid email or password.
        </p>
      ) : null}
      <form action={loginAction} className="flex flex-col gap-3">
        <label className="flex flex-col text-sm">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="rounded border p-2"
          />
        </label>
        <label className="flex flex-col text-sm">
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded bg-black p-2 text-white">
          Sign in
        </button>
      </form>
      <p className="mt-4 text-sm">
        <a href="/register" className="underline">
          Create an account
        </a>{' '}
        ·{' '}
        <a href="/forgot-password" className="underline">
          Forgot password?
        </a>
      </p>
    </main>
  );
}
