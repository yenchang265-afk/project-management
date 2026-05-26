'use client';

// Client form for issue creation. We use a plain textarea for the description
// (Tiptap is installed but the MVP UI keeps server bundle slim).

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'] as const;
const PRIORITIES = ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST'] as const;

export function NewIssueForm({ projectKey }: { projectKey: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('TASK');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('MEDIUM');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectKey}/issues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, description: description || undefined, type, priority }),
      });
      const data = (await res.json()) as { issue?: { key: string }; error?: { message: string } };
      if (!res.ok || !data.issue) {
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
      router.push(`/projects/${projectKey}/issues/${data.issue.key}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unknown error');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border p-2"
          data-testid="issue-title-input"
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded border p-2 font-mono text-sm"
        />
      </div>
      <div className="flex gap-4">
        <div>
          <label className="block text-sm font-medium" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
            className="mt-1 rounded border p-2"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="priority">
            Priority
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}
            className="mt-1 rounded border p-2"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      {err ? (
        <p className="text-sm text-red-600" data-testid="issue-create-error">
          {err}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        data-testid="issue-create-submit"
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create issue'}
      </button>
    </form>
  );
}
