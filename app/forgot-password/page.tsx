// Forgot password page. Server action calls /api/auth/forgot-password and
// always renders the success state — we never reveal whether the email exists.

import { redirect } from 'next/navigation';

async function submit(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('email') ?? '');
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  await fetch(`${base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  }).catch(() => undefined);
  redirect('/forgot-password?sent=1');
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-semibold">Reset your password</h1>
      {sent ? (
        <p className="mb-3 rounded border border-green-300 bg-green-50 p-2 text-sm text-green-700">
          If an account exists for that address, a reset link is on its way.
        </p>
      ) : (
        <form action={submit} className="flex flex-col gap-3">
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
          <button type="submit" className="rounded bg-black p-2 text-white">
            Send reset link
          </button>
        </form>
      )}
    </main>
  );
}
