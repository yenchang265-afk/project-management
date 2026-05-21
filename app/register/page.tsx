// Registration page. Posts to /api/auth/register on the client, then
// auto-signs in via Credentials. Server-rendered with a minimal client island
// so we get instant inline error feedback without a full reload.

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signIn } from 'next-auth/react';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const name = String(formData.get('name') ?? '');

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      const code = body.error?.code;
      setError(
        code === 'email_taken'
          ? 'That email is already registered.'
          : code === 'invalid_input'
            ? 'Please check your email and use a password of at least 8 characters.'
            : 'Something went wrong. Try again.',
      );
      setBusy(false);
      return;
    }

    // Auto-sign-in via credentials.
    const signInRes = await signIn('credentials', { email, password, redirect: false });
    if (signInRes?.error) {
      setError('Account created but auto sign-in failed. Please sign in manually.');
      setBusy(false);
      return;
    }
    router.push('/profile');
  }

  return (
    <main className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-semibold">Create your account</h1>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col text-sm">
          Name
          <input
            type="text"
            name="name"
            required
            autoComplete="name"
            className="rounded border p-2"
          />
        </label>
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
            minLength={8}
            autoComplete="new-password"
            className="rounded border p-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-black p-2 text-white disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm">
        <a href="/login" className="underline">
          Already have an account?
        </a>
      </p>
    </main>
  );
}
