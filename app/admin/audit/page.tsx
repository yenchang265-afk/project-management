// /admin/audit — admin-only audit log surface.
//
// Server component. Fetches the page directly from the audit service so we
// avoid a self-request to the API. Filter form is a small client island.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createAuthService } from '@/server/services/auth';
import { createAuditService } from '@/server/services/audit';

import { FilterForm } from './filter-form';

export const dynamic = 'force-dynamic';

type SearchParams = {
  kind?: string;
  actorId?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export default async function AuditPage(props: { searchParams: Promise<SearchParams> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof AuthError && err.code === 'unauthenticated') redirect('/login');
    throw err;
  }
  // RBAC: re-read from DB so revoked admins lose access immediately.
  const authSvc = createAuthService({ prisma });
  const role = await authSvc.getMembershipRole(actor.id);
  if (role !== 'ADMIN') {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Forbidden</h1>
        <p>This page is admin-only.</p>
      </main>
    );
  }

  const sp = await props.searchParams;
  const filters = {
    kind: sp.kind,
    actorId: sp.actorId,
    from: parseDate(sp.from),
    to: parseDate(sp.to),
  };

  const svc = createAuditService({ prisma });
  const page = await svc.listAuditEvents({ filters, cursor: sp.cursor, limit: 50 });

  // Resolve actor emails for display (best-effort).
  const actorIds = Array.from(
    new Set(page.data.map((e) => e.actorId).filter((x): x is string => !!x)),
  );
  const userRows =
    actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
  const emailByActor = new Map(userRows.map((u) => [u.id, u.email]));

  const exportQs = new URLSearchParams();
  if (sp.kind) exportQs.set('kind', sp.kind);
  if (sp.actorId) exportQs.set('actorId', sp.actorId);
  if (sp.from) exportQs.set('from', sp.from);
  if (sp.to) exportQs.set('to', sp.to);
  const exportUrl = `/api/admin/audit/export.csv${exportQs.size > 0 ? `?${exportQs.toString()}` : ''}`;

  return (
    <main style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Audit log</h1>
        <a
          href={exportUrl}
          download
          data-testid="audit-csv-download"
          style={{
            padding: '6px 12px',
            border: '1px solid #888',
            borderRadius: 4,
            textDecoration: 'none',
            color: '#222',
          }}
        >
          Download CSV
        </a>
      </header>

      <FilterForm />

      {page.data.length === 0 ? (
        <p style={{ color: '#666' }}>No audit events match the current filters.</p>
      ) : (
        <table
          data-testid="audit-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: 8 }}>At</th>
              <th style={{ padding: 8 }}>Kind</th>
              <th style={{ padding: 8 }}>Actor</th>
              <th style={{ padding: 8 }}>Target</th>
              <th style={{ padding: 8 }}>Payload</th>
            </tr>
          </thead>
          <tbody>
            {page.data.map((row) => (
              <tr
                key={row.id}
                data-testid={`audit-row-${row.id}`}
                style={{ borderBottom: '1px solid #eee' }}
              >
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                  {row.at.toISOString()}
                </td>
                <td style={{ padding: 8 }}>
                  <code>{row.kind}</code>
                </td>
                <td style={{ padding: 8 }}>
                  {row.actorId ? (emailByActor.get(row.actorId) ?? row.actorId) : '—'}
                </td>
                <td style={{ padding: 8 }}>{row.target ?? '—'}</td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                  {JSON.stringify(row.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page.pageInfo.hasMore && page.pageInfo.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={`/admin/audit?${new URLSearchParams({
              ...(sp.kind ? { kind: sp.kind } : {}),
              ...(sp.actorId ? { actorId: sp.actorId } : {}),
              ...(sp.from ? { from: sp.from } : {}),
              ...(sp.to ? { to: sp.to } : {}),
              cursor: page.pageInfo.nextCursor,
            }).toString()}`}
            data-testid="audit-next-page"
          >
            Next page →
          </Link>
        </div>
      ) : null}
    </main>
  );
}
