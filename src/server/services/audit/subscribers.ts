// Audit event subscribers (Phase 5a).
//
// Subscribes to existing `auth.*` events on the legacy domain bus (see
// src/server/events/bus.ts). Each event is translated into an AuditEvent row
// via `recordAuditEvent`. Subscribers are fire-and-forget — they catch their
// own errors so a misbehaving handler can't break a mutation.
//
// Phase 4c shipped a similar pattern for notifications; we keep them
// independent so a single bus reset in tests still works.
//
// PROJECT EVENTS:
//   The projects service does not currently emit on the bus, and the Phase 5a
//   constraints forbid editing it. Rather than ship a half-working audit
//   trail by wrapping Prisma (a Prisma `$extends` was considered but proved
//   fragile w.r.t. typing across phases), we limit Phase 5a's auto-captured
//   events to the `auth.*` family that already exists on the bus. Project /
//   role events can be added with a one-line subscriber registration in
//   future phases as those services start publishing — the recorder is
//   reusable. See `./README.md` for the migration path.

import { subscribe, type DomainEvent } from '@/server/events/bus';

import type { RecordAuditEventInput } from './index';

export type AuditRecorder = (input: RecordAuditEventInput) => Promise<unknown>;

export type AuditSubscriberDeps = {
  record: AuditRecorder;
};

let registered = false;
const unsubscribers: Array<() => void> = [];

export function __resetAuditSubscribers(): void {
  while (unsubscribers.length > 0) {
    const off = unsubscribers.pop();
    try {
      off?.();
    } catch {
      // ignore
    }
  }
  registered = false;
}

function logError(where: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[audit/subscribers] ${where}`, err);
}

export function registerAuditSubscribers(deps: AuditSubscriberDeps): void {
  if (registered) return;
  registered = true;
  const { record } = deps;

  const off = subscribe(async (event: DomainEvent) => {
    try {
      if (event.type === 'auth.registered') {
        await record({
          kind: 'auth.register',
          actorId: event.payload.userId,
          target: event.payload.userId,
          // Email is fine to log; it's already in User. The bus payload for
          // this event has no secret material.
          payload: { email: event.payload.email },
        });
      } else if (event.type === 'auth.password_reset_requested') {
        // CRITICAL: do NOT include the reset token in the audit row. The
        // token is a bearer credential; logging it would defeat the rate-limit
        // and clock-window protections in the auth service.
        await record({
          kind: 'auth.password_reset_requested',
          actorId: event.payload.userId,
          target: event.payload.userId,
          payload: { email: event.payload.email },
        });
      }
    } catch (err) {
      logError(event.type, err);
    }
  });
  unsubscribers.push(off);
}
