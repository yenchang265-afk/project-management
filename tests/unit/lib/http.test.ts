// Response envelope helpers added in Phase 5b.
//
// `list()` is the standard shape returned by every paginated list endpoint:
//   { data: T[], pageInfo: { nextCursor, hasMore } }
// `error()` standardizes the failure envelope with a stable `code`.
// Existing helpers (ok/created/noContent/badRequest/notFound/...) must stay
// untouched so we don't break Phase 1–4 route handlers.

import { describe, expect, it } from 'vitest';

import { created, error, list, noContent, ok } from '@/lib/http';

describe('list()', () => {
  it('wraps data + pageInfo with status 200', async () => {
    const res = list({
      data: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'cur-1',
      hasMore: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string }[];
      pageInfo: { nextCursor: string | null; hasMore: boolean };
    };
    expect(body.data.map((d) => d.id)).toEqual(['a', 'b']);
    expect(body.pageInfo).toEqual({ nextCursor: 'cur-1', hasMore: true });
  });

  it('emits null nextCursor / hasMore=false when no more pages', async () => {
    const res = list({ data: [], nextCursor: null, hasMore: false });
    const body = (await res.json()) as { pageInfo: { nextCursor: string | null } };
    expect(body.pageInfo.nextCursor).toBeNull();
  });
});

describe('error()', () => {
  it('returns { error: { code, message } } at the requested status', async () => {
    const res = error({ status: 418, code: 'teapot', message: 'short and stout' });
    expect(res.status).toBe(418);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: 'teapot', message: 'short and stout' });
  });

  it('passes through details when provided', async () => {
    const res = error({
      status: 400,
      code: 'invalid_input',
      message: 'bad fields',
      details: { fields: ['email'] },
    });
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(body.error.details).toEqual({ fields: ['email'] });
  });
});

describe('backward compatibility', () => {
  it('still exposes ok/created/noContent', async () => {
    expect((await ok({ a: 1 }).json()) as { a: number }).toEqual({ a: 1 });
    expect(created({ id: 'x' }).status).toBe(201);
    expect(noContent().status).toBe(204);
  });
});
