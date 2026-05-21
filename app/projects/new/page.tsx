// /projects/new — create-project form. Client island so we can show
// inline errors and redirect on success.

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NewProjectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      key: String(form.get('key') ?? '').toUpperCase(),
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
    };
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      const code = body.error?.code;
      setError(
        code === 'duplicate_key'
          ? 'That project key is already in use.'
          : code === 'invalid_input'
            ? (body.error?.message ?? 'Please fix the highlighted fields.')
            : code === 'forbidden'
              ? 'You do not have permission to create a project.'
              : 'Something went wrong. Try again.',
      );
      setBusy(false);
      return;
    }
    const body = (await res.json()) as { key: string };
    router.push(`/projects/${body.key}`);
  }

  return (
    <main className="mx-auto mt-12 max-w-md p-4">
      <h1 className="mb-4 text-2xl font-semibold">New project</h1>
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
          Key (2–10 chars, starts with a letter)
          <input
            type="text"
            name="key"
            required
            pattern="[A-Za-z][A-Za-z0-9]{1,9}"
            className="rounded border p-2 font-mono uppercase"
          />
        </label>
        <label className="flex flex-col text-sm">
          Name
          <input type="text" name="name" required className="rounded border p-2" />
        </label>
        <label className="flex flex-col text-sm">
          Description
          <textarea name="description" rows={3} className="rounded border p-2" />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-black p-2 text-white disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </main>
  );
}
