'use client';

// Saved-filters dropdown shared by the board, backlog, and search pages.
// - Lists the current user's filters (optionally scoped to a project).
// - Clicking a filter dispatches a custom event the host page can listen on
//   to apply the filter; for now we just navigate to the same page with the
//   filter's query encoded as search params (best-effort — different host
//   pages translate those params differently).
// - "Save current filter" reads the current URL search params and POSTs them.

import { useEffect, useState } from 'react';

type SavedFilter = {
  id: string;
  name: string;
  projectId: string | null;
  query: Record<string, unknown>;
};

export function SavedFiltersDropdown({ projectId }: { projectId?: string }) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetch(`/api/saved-filters${qs}`);
    if (!res.ok) return;
    const body = (await res.json()) as { data: SavedFilter[] };
    setFilters(body.data);
  }

  function apply(f: SavedFilter) {
    const url = new URL(window.location.href);
    // Wipe existing filter params before applying.
    Array.from(url.searchParams.keys()).forEach((k) => url.searchParams.delete(k));
    for (const [k, v] of Object.entries(f.query ?? {})) {
      if (Array.isArray(v)) {
        v.forEach((vv) => url.searchParams.append(k, String(vv)));
      } else if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
    window.location.assign(url.toString());
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = new URL(window.location.href);
      const query: Record<string, unknown> = {};
      for (const k of new Set(url.searchParams.keys())) {
        const all = url.searchParams.getAll(k);
        query[k] = all.length > 1 ? all : all[0];
      }
      const body: { name: string; query: Record<string, unknown>; projectId?: string } = {
        name: name.trim(),
        query,
      };
      if (projectId) body.projectId = projectId;
      const res = await fetch('/api/saved-filters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setName('');
        setOpen(false);
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" data-testid="saved-filters-dropdown">
      <button
        type="button"
        className="rounded border px-3 py-1 text-sm"
        onClick={() => setOpen((v) => !v)}
        data-testid="saved-filters-toggle"
      >
        Saved filters ({filters.length})
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 w-64 rounded border bg-white p-3 shadow">
          <ul className="mb-2 max-h-48 overflow-auto">
            {filters.length === 0 ? (
              <li className="text-sm text-gray-500">No saved filters yet.</li>
            ) : (
              filters.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-1">
                  <button
                    type="button"
                    className="flex-1 truncate text-left text-sm hover:underline"
                    onClick={() => apply(f)}
                    data-testid={`apply-filter-${f.id}`}
                  >
                    {f.name}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={async () => {
                      await fetch(`/api/saved-filters/${f.id}`, { method: 'DELETE' });
                      await refresh();
                    }}
                    data-testid={`delete-filter-${f.id}`}
                  >
                    ✕
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="border-t pt-2">
            <input
              type="text"
              placeholder="Name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mb-1 w-full rounded border px-2 py-1 text-sm"
              data-testid="saved-filter-name"
            />
            <button
              type="button"
              disabled={saving || !name.trim()}
              onClick={save}
              className="w-full rounded bg-blue-600 px-2 py-1 text-sm text-white disabled:opacity-50"
              data-testid="save-filter-submit"
            >
              {saving ? 'Saving…' : 'Save current filter'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
