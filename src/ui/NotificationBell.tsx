'use client';

// Small client component: bell icon + popover that shows the latest 10
// unread notifications. Polls /api/notifications every 30s. Clicking a row
// marks it read and navigates to the issue.

import { useCallback, useEffect, useState } from 'react';

type NotificationRow = {
  id: string;
  kind: string;
  payload: { issueKey?: string; actorId?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
};

type ListResponse = {
  data: NotificationRow[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
  unreadCount: number;
};

async function fetchList(onlyUnread = false): Promise<ListResponse | null> {
  try {
    const qs = onlyUnread ? '?onlyUnread=1&limit=10' : '?limit=10';
    const res = await fetch(`/api/notifications${qs}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as ListResponse;
  } catch {
    return null;
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);

  const refresh = useCallback(async () => {
    const result = await fetchList(false);
    if (!result) return;
    setUnread(result.unreadCount);
    setRows(result.data);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    void refresh();
  };

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'same-origin' });
    void refresh();
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label="Notifications"
        data-testid="notification-bell"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          padding: 8,
          position: 'relative',
        }}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span
            data-testid="notification-unread-count"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#d33',
              color: 'white',
              borderRadius: 8,
              padding: '0 4px',
              fontSize: 10,
            }}
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="notification-drawer"
          role="dialog"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            width: 320,
            background: 'white',
            border: '1px solid #ddd',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            padding: 8,
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: 4,
              borderBottom: '1px solid #eee',
            }}
          >
            <strong>Notifications</strong>
            <button type="button" onClick={() => void markAllRead()}>
              Mark all read
            </button>
          </div>
          {rows.length === 0 && <p style={{ padding: 8 }}>No notifications yet.</p>}
          <ul
            style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 320, overflowY: 'auto' }}
          >
            {rows.map((n) => {
              const key = typeof n.payload.issueKey === 'string' ? n.payload.issueKey : '';
              const href = key ? `/issues/${encodeURIComponent(key)}` : '#';
              return (
                <li
                  key={n.id}
                  data-testid="notification-row"
                  data-kind={n.kind}
                  data-issue-key={key}
                  style={{
                    padding: 8,
                    borderBottom: '1px solid #f3f3f3',
                    background: n.readAt ? 'white' : '#fffbe6',
                  }}
                >
                  <a
                    href={href}
                    onClick={() => void markRead(n.id)}
                    style={{ textDecoration: 'none', color: '#333' }}
                  >
                    <div style={{ fontWeight: 600 }}>{n.kind.replace(/_/g, ' ')}</div>
                    {key && <div style={{ fontSize: 12, color: '#666' }}>{key}</div>}
                  </a>
                </li>
              );
            })}
          </ul>
          <div style={{ padding: 4, borderTop: '1px solid #eee', textAlign: 'right' }}>
            <a href="/notifications">View all</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
