'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SprintActions({
  sprintId,
  state,
  projectKey,
}: {
  sprintId: string;
  state: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  projectKey: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(path, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      router.refresh();
      if (path.endsWith('/start')) router.push(`/projects/${projectKey}/active-sprint`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {state === 'PLANNED' ? (
        <button
          type="button"
          onClick={() => call(`/api/sprints/${sprintId}/start`)}
          disabled={busy}
          className="rounded bg-green-600 px-3 py-1.5 text-white disabled:opacity-50"
          data-testid="sprint-start"
        >
          {busy ? 'Starting…' : 'Start sprint'}
        </button>
      ) : null}
      {state === 'ACTIVE' ? (
        <button
          type="button"
          onClick={() => call(`/api/sprints/${sprintId}/complete`)}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
          data-testid="sprint-complete"
        >
          {busy ? 'Completing…' : 'Complete sprint'}
        </button>
      ) : null}
      {err ? <span className="text-red-600">{err}</span> : null}
    </div>
  );
}
