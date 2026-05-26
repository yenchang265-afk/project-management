// Cursor pagination helper — unit specs.
//
// Phase 5b standardizes opaque base64url cursors so list endpoints don't leak
// internal IDs/timestamps as offsets. The encoder is a tiny JSON-base64url
// shim; the decoder is forgiving (returns null on garbage) so route handlers
// can normalize a missing or malformed `?cursor=` into "start from the top".

import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, paginate } from '@/lib/pagination/cursor';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a Date + id', () => {
    const at = new Date('2026-05-21T07:00:00.000Z');
    const id = 'abc123';
    const c = encodeCursor({ at, id });
    expect(typeof c).toBe('string');
    expect(c).not.toContain('=');
    expect(c).not.toContain('+');
    expect(c).not.toContain('/');
    const decoded = decodeCursor(c);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(id);
    expect(decoded!.at.toISOString()).toBe(at.toISOString());
  });

  it('accepts ISO string input on encode', () => {
    const c = encodeCursor({ at: '2026-05-21T07:00:00.000Z', id: 'x' });
    const decoded = decodeCursor(c);
    expect(decoded?.at.toISOString()).toBe('2026-05-21T07:00:00.000Z');
  });

  it('returns null for malformed cursor strings', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-base64!!!')).toBeNull();
    expect(decodeCursor('Zm9v')).toBeNull(); // base64 of "foo" — not JSON
    // valid JSON but wrong shape
    expect(decodeCursor(Buffer.from(JSON.stringify({ foo: 1 })).toString('base64url'))).toBeNull();
  });
});

describe('paginate()', () => {
  type Row = { id: string; createdAt: Date };
  const mkRow = (id: string, iso: string): Row => ({ id, createdAt: new Date(iso) });

  it('returns hasMore=false and nextCursor=null when items <= limit', () => {
    const items: Row[] = [
      mkRow('a', '2026-05-01T00:00:00.000Z'),
      mkRow('b', '2026-05-02T00:00:00.000Z'),
    ];
    const out = paginate({ items, limit: 5 });
    expect(out.data).toEqual(items);
    expect(out.pageInfo.hasMore).toBe(false);
    expect(out.pageInfo.nextCursor).toBeNull();
  });

  it('emits a cursor pointing at the LAST returned row when items > limit', () => {
    // The caller is expected to fetch limit+1 items so paginate() can detect
    // overflow without an extra COUNT query.
    const items: Row[] = [
      mkRow('a', '2026-05-01T00:00:00.000Z'),
      mkRow('b', '2026-05-02T00:00:00.000Z'),
      mkRow('c', '2026-05-03T00:00:00.000Z'),
    ];
    const out = paginate({ items, limit: 2 });
    expect(out.data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.pageInfo.hasMore).toBe(true);
    const decoded = decodeCursor(out.pageInfo.nextCursor!);
    expect(decoded?.id).toBe('b');
    expect(decoded?.at.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('is stable when items share createdAt (id is the tiebreaker)', () => {
    const ts = '2026-05-01T00:00:00.000Z';
    const items: Row[] = [mkRow('a', ts), mkRow('b', ts), mkRow('c', ts)];
    const out = paginate({ items, limit: 2 });
    expect(out.data.map((r) => r.id)).toEqual(['a', 'b']);
    const decoded = decodeCursor(out.pageInfo.nextCursor!);
    // Tiebreaker: cursor's id is the id of the last returned row, not the
    // dropped row — so the next page starts strictly after (createdAt, id) = (ts, 'b').
    expect(decoded?.id).toBe('b');
    expect(decoded?.at.toISOString()).toBe(ts);
  });

  it('handles limit=0 by returning no data with overflow detection', () => {
    const items: Row[] = [mkRow('a', '2026-05-01T00:00:00.000Z')];
    const out = paginate({ items, limit: 0 });
    expect(out.data).toEqual([]);
    expect(out.pageInfo.hasMore).toBe(true);
    // With limit 0 we still need a cursor if any items came back — but we
    // have nothing to anchor to, so it stays null (caller must adjust).
    expect(out.pageInfo.nextCursor).toBeNull();
  });
});
