// Unit tests for audit.exportAuditEventsCsv.
//
// Contract:
//   - Streams to writer; never buffers full result set.
//   - Header row: id,at,kind,actorId,actorEmail,target,payload
//   - CSV-escapes commas, quotes, newlines per RFC 4180.

import { beforeEach, describe, expect, it } from 'vitest';

import { createAuditService } from '@/server/services/audit';

import { createFakePrisma, type FakePrisma } from './fakePrisma';

class CollectingWriter {
  chunks: string[] = [];
  write(chunk: string | Buffer): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    return true;
  }
  end(): void {
    /* no-op */
  }
  get text(): string {
    return this.chunks.join('');
  }
}

describe('auditService.exportAuditEventsCsv', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createAuditService>;

  beforeEach(async () => {
    prisma = createFakePrisma();
    svc = createAuditService({ prisma: prisma as never });
    prisma._addUser('u_1', 'one@example.com');
    prisma._addUser('u_2', 'two@example.com');
  });

  it('writes a header row then one row per event', async () => {
    await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_1', payload: { ok: true } });
    await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_2', payload: { ok: false } });
    const w = new CollectingWriter();
    await svc.exportAuditEventsCsv({}, w);
    const lines = w.text.trim().split('\n');
    expect(lines[0]).toBe('id,at,kind,actorId,actorEmail,target,payload');
    expect(lines).toHaveLength(3);
  });

  it('joins actorEmail from the user table', async () => {
    await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_1', payload: {} });
    const w = new CollectingWriter();
    await svc.exportAuditEventsCsv({}, w);
    expect(w.text).toContain('one@example.com');
  });

  it('escapes commas, quotes, and newlines in payload (RFC 4180)', async () => {
    await svc.recordAuditEvent({
      kind: 'project.renamed',
      actorId: 'u_1',
      payload: { name: 'a, b "x" \nlinebreak' },
    });
    const w = new CollectingWriter();
    await svc.exportAuditEventsCsv({}, w);
    // The payload JSON contains " and , so the field must be wrapped in
    // double-quotes and inner quotes doubled.
    const dataLine = w.text.split('\n').slice(1).join('\n');
    expect(dataLine).toMatch(/"\{""name"":"/);
  });

  it('streams in chunks (does not load all rows in memory)', async () => {
    // Seed 2500 events so the service must page through.
    for (let i = 0; i < 2500; i++) {
      await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_1', payload: { i } });
    }
    const w = new CollectingWriter();
    await svc.exportAuditEventsCsv({}, w);
    const lines = w.text.trim().split('\n');
    expect(lines).toHaveLength(2501); // header + 2500
    // We should have written more than one chunk along the way.
    expect(w.chunks.length).toBeGreaterThan(1);
  });

  it('respects kind filter', async () => {
    await svc.recordAuditEvent({ kind: 'auth.login', actorId: 'u_1', payload: {} });
    await svc.recordAuditEvent({ kind: 'project.created', actorId: 'u_1', payload: {} });
    const w = new CollectingWriter();
    await svc.exportAuditEventsCsv({ filters: { kind: 'project.created' } }, w);
    const lines = w.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('project.created');
  });
});
