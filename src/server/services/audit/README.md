# Audit Log Service — Phase 5a

Append-only org-level audit log. Per-issue audit lives in
`ActivityLogEntry` (Phase 3) and is **not** duplicated here.

## Public Contract

```ts
const svc = createAuditService({ prisma });

await svc.recordAuditEvent({
  kind: 'auth.register',
  actorId: 'u_1',
  target: 'u_1',
  payload: { email: 'a@b.com' },
  ip?: '1.2.3.4',
  userAgent?: 'Mozilla/5.0',
});

const page = await svc.listAuditEvents({
  filters: { kind?: string; actorId?: string; from?: Date; to?: Date },
  cursor?: string,
  limit?: number, // default 50, max 200
});

await svc.exportAuditEventsCsv({ filters }, writer);
```

### Guarantees

- `recordAuditEvent` is **fire-and-forget**: it never throws to the caller.
  Failures are logged via `console.error` and the function returns `null`.
- `listAuditEvents` paginates with cursor `(at DESC, id DESC)` — the row's
  `id` is the cursor. Limit clamped to `[1, 200]`.
- `exportAuditEventsCsv` streams chunks of up to 1000 rows. Memory is
  bounded regardless of result set size. Output respects RFC 4180 CSV
  escaping for commas / quotes / newlines.

### Kinds (informal)

Free-form string. Suggested prefixes:

- `auth.*` — `auth.register`, `auth.password_reset_requested`,
  `auth.password_reset_completed`, `auth.login` (future)
- `project.*` — `project.created`, `project.renamed`, `project.archived`
  (not auto-captured yet — see below)
- `role.*` — `role.granted`, `role.revoked` (not auto-captured yet)

## Subscribers

`registerAuditSubscribers({ record })` (called once from
`src/server/bootstrap.ts`) wires the legacy `DomainEvent` bus (`auth.*`
events) into `recordAuditEvent`.

### What about project / role events?

Phase 5a's constraints forbid editing the existing projects / auth services.
Two approaches were considered:

1. **Prisma client extensions** (`prisma.$extends`) to hook `Project.create
/update`. Rejected: the extension API requires reshaping the client type
   across the codebase, which violates the "only additive exports" rule.
2. **HTTP middleware** intercepting `/api/projects/*`. Rejected: the projects
   service is the source of truth, and a middleware-only approach would miss
   internal callers (jobs, future services).

**Adopted approach**: ship subscribers for `auth.*` events only in Phase 5a.
When the projects / role services start emitting on the bus (planned for
Phase 5b's hardening pass), register additional subscribers here — the
`recordAuditEvent` API is reusable. Until then, admins can record those
events manually via the service.

## Routes

- `GET /api/admin/audit` — admin-only list with filters & cursor.
- `GET /api/admin/audit/export.csv` — admin-only streaming CSV download.

## UI

- `/admin/audit` — server-component table with filter form + CSV button.
- The header shows an **Admin** link for users with `role = ADMIN`.
