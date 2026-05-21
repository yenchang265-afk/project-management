import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { bootstrapServer } from '@/server/bootstrap';
import { NotificationBell } from '@/ui/NotificationBell';
import { AdminLink } from '@/ui/AdminLink';

export const metadata: Metadata = {
  title: 'Project Management',
  description: 'Jira-like project management application',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Bootstrap is idempotent (module-level guard). Calling it inside the
  // root layout means subscribers + workers register on the first SSR.
  bootstrapServer();
  return (
    <html lang="en">
      <body>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 16px',
            borderBottom: '1px solid #eee',
            height: 48,
          }}
        >
          <Link href="/" style={{ fontWeight: 700, textDecoration: 'none', color: '#222' }}>
            Project Management
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* phase-5a:admin-link:start */}
            <AdminLink />
            {/* phase-5a:admin-link:end */}
            {/* phase-4c:notification-bell:start */}
            <NotificationBell />
            {/* phase-4c:notification-bell:end */}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
