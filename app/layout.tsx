import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { bootstrapServer } from '@/server/bootstrap';
import { NotificationBell } from '@/ui/NotificationBell';

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
          {/* phase-4c:notification-bell:start */}
          <NotificationBell />
          {/* phase-4c:notification-bell:end */}
        </header>
        {children}
      </body>
    </html>
  );
}
