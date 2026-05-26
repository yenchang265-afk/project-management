# `@/server/auth`

Cross-cutting authentication and authorization helpers. Every Phase 2+ slice
talks to identity through this module — do not call `next-auth` directly from
route handlers or pages.

## Exports

### `auth()` — re-exported from `next-auth`

Returns the current `Session | null`. Use it directly only inside guards or for
optional-auth UI; production code paths should prefer `requireUser()`.

### `requireUser(): Promise<SessionUser>`

Throws `AuthError('unauthenticated')` if no session. Returns:

```ts
type SessionUser = { id: string; email: string; name: string | null; role: Role };
```

The `role` is sourced from the JWT (set at sign-in time). Use this when the
exact role doesn't matter (just "is anyone signed in?").

### `requireUserWithRole(min: Role): Promise<SessionUser>`

Like `requireUser` but additionally re-reads the user's `OrgMembership.role`
from the database and rejects with `AuthError('forbidden')` if the role rank
is below `min`. Re-reading from the DB is intentional: it lets admins revoke
roles without waiting for the JWT to expire.

### `requireProjectAccess(projectKey, min): Promise<{ user, project, role }>`

Looks up the project by `key`, resolves the caller's effective role as
`max(orgRole, projectMember.role)` (ADMIN always wins), and rejects if it's
below `min`.

Errors (all `AuthError`):

- `unauthenticated` — no session.
- `not_found` — project key not found.
- `forbidden` — caller is not a project member (and not org ADMIN), or the
  effective role is below `min`.

Returns `{ user, project, role }` where `role` is the resolved effective role.

### `requireRole(actual, min)` / `hasRoleAtLeast(actual, min)` / `ROLE_RANK`

Pure role-hierarchy helpers (re-exported from `./roles`). Order:

```
VIEWER < MEMBER < LEAD < ADMIN
```

## How to extend

- Need a new error code? Add it to `AuthErrorCode` in `src/lib/errors.ts` and
  decide its HTTP status in the route handlers that surface it.
- Need a new provider? Wire it in `src/server/auth/index.ts`. Keep
  service-level behavior in `src/server/services/auth` — providers are thin
  adapters.

## Phase 1 boundaries

- Single global org (no tenancy). One row per user in `OrgMembership`; absent
  membership defaults to `MEMBER`.
- No avatar upload yet (deferred until MinIO integration). `/profile` carries
  a TODO marker.
- Reset emails are emitted via the in-process event bus only; a real consumer
  ships in Phase 4 with `pg-boss` + Nodemailer.
