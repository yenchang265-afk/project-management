// Unit tests for audit.listAuditEvents.
//
// Contract:
//   - Filters: kind, actorId, from, to (inclusive on `at`).
//   - Cursor pagination via (at, id) — newest first.
//   - Default limit 50, max 200.

import { beforeEach, describe, expect, it } from 'vitest';

import { createAuditService } from '@/server/services/audit';

import { createFakePrisma, type FakePrisma } from './fakePrisma';

describe('auditService.listAuditEvents', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createAuditService>;

  beforeEach(async () => {
    prisma = createFakePrisma();
    svc = createAuditService({ prisma: prisma as never });
    // Seed 5 events with varying kinds + actors.
    await svc.recordAuditEvent({ kind: 'auth.registered', actorId: 'u_1', payload: {} });
    await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_1', payload: {} });
    await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_2', payload: {} });
    await svc.recordAuditEvent({ kind: 'project.created', actorId: 'u_1', payload: {} });
    await svc.recordAuditEvent({ kind: 'project.archived', actorId: 'u_2', payload: {} });
  });

  it('returns all events when no filters, newest first', async () => {
    const page = await svc.listAuditEvents({});
    expect(page.data).toHaveLength(5);
    // Newest first → last event we wrote (project.archived) comes first.
    expect(page.data[0]!.kind).toBe('project.archived');
  });

  it('filters by kind', async () => {
    const page = await svc.listAuditEvents({ filters: { kind: 'auth.login' } });
    expect(page.data).toHaveLength(2);
    for (const e of page.data) expect(e.kind).toBe('auth.login');
  });

  it('filters by actorId', async () => {
    const page = await svc.listAuditEvents({ filters: { actorId: 'u_2' } });
    expect(page.data).toHaveLength(2);
    for (const e of page.data) expect(e.actorId).toBe('u_2');
  });

  it('paginates via cursor when there are more rows than the limit', async () => {
    const page1 = await svc.listAuditEvents({ limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.pageInfo.hasMore).toBe(true);
    expect(page1.pageInfo.nextCursor).toBeTruthy();

    const page2 = await svc.listAuditEvents({ limit: 2, cursor: page1.pageInfo.nextCursor! });
    expect(page2.data).toHaveLength(2);
    // No overlap with page1
    const ids1 = new Set(page1.data.map((e) => e.id));
    for (const e of page2.data) expect(ids1.has(e.id)).toBe(false);
  });

  it('signals hasMore=false on the last page', async () => {
    const page = await svc.listAuditEvents({ limit: 100 });
    expect(page.pageInfo.hasMore).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });
});
