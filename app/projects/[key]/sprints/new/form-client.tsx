'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewSprintForm({ projectKey }: { projectKey: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectKey}/sprints`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, goal: goal || undefined }),
      });
      const data = (await res.json()) as {
        sprint?: { id: string };
        error?: { message: string };
      };
      if (!res.ok || !data.sprint) {
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      router.push(`/projects/${projectKey}/sprints/${data.sprint.id}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unknown error');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border p-2"
          data-testid="sprint-name-input"
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="goal">
          Goal (optional)
        </label>
        <textarea
          id="goal"
          name="goal"
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="mt-1 w-full rounded border p-2"
          data-testid="sprint-goal-input"
        />
      </div>
      {err ? (
        <p className="text-sm text-red-600" data-testid="sprint-create-error">
          {err}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        data-testid="sprint-create-submit"
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create sprint'}
      </button>
    </form>
  );
}
