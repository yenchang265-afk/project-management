'use client';

import { useEffect, useState } from 'react';

const KINDS = [
  'ISSUE_ASSIGNED',
  'ISSUE_MENTIONED',
  'ISSUE_COMMENTED',
  'ISSUE_TRANSITIONED',
  'ISSUE_CREATED_IN_WATCHED',
  'SPRINT_STARTED',
  'SPRINT_COMPLETED',
] as const;
const CHANNELS = ['IN_APP', 'EMAIL'] as const;

type Preference = {
  kind: (typeof KINDS)[number];
  channel: (typeof CHANNELS)[number];
  enabled: boolean;
};

export default function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<Preference[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetch('/api/notifications/preferences', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as { preferences: Preference[] };
      if (active) setPrefs(data.preferences);
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (
    kind: Preference['kind'],
    channel: Preference['channel'],
    enabled: boolean,
  ) => {
    setPrefs((prev) =>
      prev.map((p) => (p.kind === kind && p.channel === channel ? { ...p, enabled } : p)),
    );
    await fetch('/api/notifications/preferences', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, channel, enabled }),
    });
  };

  const lookup = (kind: Preference['kind'], channel: Preference['channel']) =>
    prefs.find((p) => p.kind === kind && p.channel === channel)?.enabled ?? true;

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1>Notification preferences</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Event</th>
            {CHANNELS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KINDS.map((kind) => (
            <tr key={kind}>
              <td style={{ padding: 6 }}>{kind.replace(/_/g, ' ')}</td>
              {CHANNELS.map((channel) => (
                <td key={channel} style={{ textAlign: 'center', padding: 6 }}>
                  <input
                    type="checkbox"
                    data-testid={`pref-${kind}-${channel}`}
                    checked={lookup(kind, channel)}
                    onChange={(e) => void toggle(kind, channel, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
