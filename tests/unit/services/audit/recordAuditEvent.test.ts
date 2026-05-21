// Unit tests for audit.recordAuditEvent.
//
// Contract:
//   - Writes a row with the supplied kind/payload (and optional actor/ip/UA).
//   - Never throws to caller; logs and returns null on Prisma failure.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditService } from '@/server/services/audit';

import { createFakePrisma, type FakePrisma } from './fakePrisma';

describe('auditService.recordAuditEvent', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createAuditService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    svc = createAuditService({ prisma: prisma as never });
  });

  it('writes a row with all supplied fields', async () => {
    const row = await svc.recordAuditEvent({
      kind: 'auth.registered',
      actorId: 'u_1',
      target: 'u_1',
      payload: { email: 'a@b.com' },
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    });
    expect(row).not.toBeNull();
    expect(prisma._state.events).toHaveLength(1);
    const ev = prisma._state.events[0]!;
    expect(ev.kind).toBe('auth.registered');
    expect(ev.actorId).toBe('u_1');
    expect(ev.target).toBe('u_1');
    expect(ev.ip).toBe('1.2.3.4');
    expect(ev.userAgent).toBe('Mozilla/5.0');
    expect(ev.payload).toEqual({ email: 'a@b.com' });
  });

  it('accepts a null actor (anonymous events)', async () => {
    const row = await svc.recordAuditEvent({
      kind: 'auth.login_failed',
      payload: { email: 'unknown@x.com' },
    });
    expect(row).not.toBeNull();
    expect(prisma._state.events[0]!.actorId).toBeNull();
  });

  it('never throws when prisma.create fails', async () => {
    const flaky = createFakePrisma({ failCreate: true });
    const flakySvc = createAuditService({ prisma: flaky as never });
    const result = await flakySvc.recordAuditEvent({
      kind: 'project.created',
      payload: { id: 'p_1' },
    });
    expect(result).toBeNull();
    expect(flaky._state.events).toHaveLength(0);
  });

  it('logs the failure to console.error but does not rethrow', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flaky = createFakePrisma({ failCreate: true });
    const flakySvc = createAuditService({ prisma: flaky as never });
    await flakySvc.recordAuditEvent({ kind: 'role.granted', payload: {} });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
