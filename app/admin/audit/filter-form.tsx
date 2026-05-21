'use client';

// Tiny client-side filter form for the /admin/audit page. Submitting it
// pushes the new query string into the URL so the server component re-renders
// with the new filters. We deliberately keep this minimal — no state lib, no
// fancy components.

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function FilterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [kind, setKind] = useState<string>(params.get('kind') ?? '');
  const [actorId, setActorId] = useState<string>(params.get('actorId') ?? '');
  const [from, setFrom] = useState<string>(params.get('from') ?? '');
  const [to, setTo] = useState<string>(params.get('to') ?? '');

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const next = new URLSearchParams();
    if (kind) next.set('kind', kind);
    if (actorId) next.set('actorId', actorId);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    router.push(`/admin/audit${next.size > 0 ? `?${next.toString()}` : ''}`);
  }

  function onReset(): void {
    setKind('');
    setActorId('');
    setFrom('');
    setTo('');
    router.push('/admin/audit');
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="audit-filter-form"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr) auto',
        gap: 8,
        alignItems: 'end',
        marginBottom: 16,
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        Kind
        <input
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          placeholder="auth.register"
          style={{ padding: 4 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        Actor ID
        <input
          name="actorId"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          placeholder="user id"
          style={{ padding: 4 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        From
        <input
          name="from"
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{ padding: 4 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        To
        <input
          name="to"
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{ padding: 4 }}
        />
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="submit" style={{ padding: '6px 10px' }}>
          Filter
        </button>
        <button type="button" onClick={onReset} style={{ padding: '6px 10px' }}>
          Clear
        </button>
      </div>
    </form>
  );
}
