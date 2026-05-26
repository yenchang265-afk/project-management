'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BacklogPickerClient({
  sprintId,
  options,
}: {
  sprintId: string;
  options: Array<{ key: string; title: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function add(key: string) {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/issues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issueKey: key }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="divide-y rounded border" data-testid="sprint-backlog">
        {options.map((o) => (
          <li key={o.key} className="flex items-center justify-between p-3 text-sm">
            <span>
              <span className="mr-2 font-mono text-xs text-gray-500">{o.key}</span>
              {o.title}
            </span>
            <button
              type="button"
              onClick={() => add(o.key)}
              disabled={busy === o.key}
              className="rounded border px-2 py-1 text-xs disabled:opacity-50"
              data-testid={`sprint-add-${o.key}`}
            >
              {busy === o.key ? 'Adding…' : 'Add'}
            </button>
          </li>
        ))}
      </ul>
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
    </div>
  );
}
