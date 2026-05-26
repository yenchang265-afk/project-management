// Unit tests for audit subscribers.
//
// Verifies the auth.* legacy bus events are translated into recordAuditEvent
// calls with the right `kind` strings.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publish, type DomainEvent } from '@/server/events/bus';
import {
  registerAuditSubscribers,
  __resetAuditSubscribers,
} from '@/server/services/audit/subscribers';

describe('audit subscribers', () => {
  let recorder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAuditSubscribers();
    recorder = vi.fn().mockResolvedValue(null);
  });

  it('translates auth.registered → kind=auth.register', async () => {
    registerAuditSubscribers({ record: recorder });
    const event: DomainEvent = {
      type: 'auth.registered',
      payload: { userId: 'u_1', email: 'a@b.com' },
    };
    await publish(event);
    expect(recorder).toHaveBeenCalledOnce();
    const call = recorder.mock.calls[0]![0];
    expect(call.kind).toBe('auth.register');
    expect(call.actorId).toBe('u_1');
    // Don't leak full payload — actor email is fine but token must NEVER appear.
    expect(call.payload).toMatchObject({ email: 'a@b.com' });
  });

  it('translates auth.password_reset_requested → kind=auth.password_reset_requested', async () => {
    registerAuditSubscribers({ record: recorder });
    await publish({
      type: 'auth.password_reset_requested',
      payload: { userId: 'u_2', email: 'r@x.com', token: 'secret-token-do-not-log' },
    });
    expect(recorder).toHaveBeenCalledOnce();
    const call = recorder.mock.calls[0]![0];
    expect(call.kind).toBe('auth.password_reset_requested');
    expect(call.actorId).toBe('u_2');
    // The reset token MUST NOT appear in audit payload (secret material).
    expect(JSON.stringify(call.payload)).not.toContain('secret-token-do-not-log');
  });

  it('is idempotent — repeated register does not double-fire', async () => {
    registerAuditSubscribers({ record: recorder });
    registerAuditSubscribers({ record: recorder });
    await publish({ type: 'auth.registered', payload: { userId: 'u_3', email: 'c@d.com' } });
    expect(recorder).toHaveBeenCalledOnce();
  });
});
