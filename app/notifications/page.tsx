'use client';

import { useCallback, useEffect, useState } from 'react';

type NotificationRow = {
  id: string;
  kind: string;
  payload: { issueKey?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
};

type ListResponse = {
  data: NotificationRow[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
  unreadCount: number;
};

export default function NotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(
    async (reset = false) => {
      const qs = new URLSearchParams();
      if (onlyUnread) qs.set('onlyUnread', '1');
      if (!reset && cursor) qs.set('cursor', cursor);
      const res = await fetch(`/api/notifications?${qs.toString()}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = (await res.json()) as ListResponse;
      setRows((prev) => (reset ? data.data : [...prev, ...data.data]));
      setHasMore(data.pageInfo.hasMore);
      setCursor(data.pageInfo.nextCursor);
    },
    [cursor, onlyUnread],
  );

  useEffect(() => {
    setRows([]);
    setCursor(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnread]);

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'same-origin' });
    setRows([]);
    setCursor(null);
    void load(true);
  };

  const markOne = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    setRows((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
  };

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1>Notifications</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(e) => setOnlyUnread(e.target.checked)}
          />{' '}
          Only unread
        </label>
        <button type="button" onClick={() => void markAllRead()}>
          Mark all read
        </button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((n) => {
          const key = typeof n.payload.issueKey === 'string' ? n.payload.issueKey : '';
          return (
            <li
              key={n.id}
              data-testid="notification-row"
              data-kind={n.kind}
              style={{
                padding: 12,
                borderBottom: '1px solid #eee',
                background: n.readAt ? 'white' : '#fffbe6',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{n.kind.replace(/_/g, ' ')}</div>
                  {key && <a href={`/issues/${encodeURIComponent(key)}`}>{key}</a>}
                </div>
                {!n.readAt && (
                  <button type="button" onClick={() => void markOne(n.id)}>
                    Mark read
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button type="button" onClick={() => void load(false)}>
          Load more
        </button>
      )}
    </main>
  );
}
