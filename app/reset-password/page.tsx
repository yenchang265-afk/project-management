// Reset password page. Token comes from the magic-link query string.

import { redirect } from 'next/navigation';

async function submit(formData: FormData): Promise<void> {
  'use server';
  const token = String(formData.get('token') ?? '');
  const newPassword = String(formData.get('password') ?? '');
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=1`);
  }
  redirect('/login?reset=1');
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = '', error } = await searchParams;
  return (
    <main className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-semibold">Choose a new password</h1>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
        >
          That reset link is invalid or has expired. Request a new one.
        </p>
      ) : null}
      <form action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <label className="flex flex-col text-sm">
          New password
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded bg-black p-2 text-white">
          Reset password
        </button>
      </form>
    </main>
  );
}
