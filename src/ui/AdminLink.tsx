'use client';

// Small client island: fetches the current user's role and renders an
// "Admin" link in the header only for ADMIN users. Uses an API endpoint
// that already exists (/api/admin/audit is the canonical "am I admin?" probe:
// a 200 means yes, anything else means no). We deliberately do this in a tiny
// island rather than wiring role into the root layout, because the layout is
// a server component shared by both auth'd and anonymous pages.

import { useEffect, useState } from 'react';
import Link from 'next/link';

export function AdminLink() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // HEAD on the audit endpoint is enough — admin returns 200, member
        // 403, anon 401. We use limit=1 to keep the page query cheap.
        const res = await fetch('/api/admin/audit?limit=1', { credentials: 'same-origin' });
        if (!alive) return;
        setIsAdmin(res.ok);
      } catch {
        if (alive) setIsAdmin(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!isAdmin) return null;
  return (
    <Link
      href="/admin/audit"
      data-testid="admin-link"
      style={{ fontSize: 14, color: '#555', textDecoration: 'none', marginRight: 12 }}
    >
      Admin
    </Link>
  );
}
