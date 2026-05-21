// Opaque cursor pagination for list endpoints.
//
// Why this shape:
//   - All list endpoints sort by (createdAt DESC, id DESC). The cursor carries
//     both fields so we can resume strictly after a known row even if many
//     rows share a createdAt (id breaks the tie).
//   - The cursor body is JSON, but encoded base64url so it looks opaque to
//     clients and survives URL/JSON transport without escaping.
//   - decodeCursor() is forgiving: anything it can't parse becomes null, and
//     callers treat that as "start from the beginning". Throwing on bad input
//     would make ?cursor= a footgun.

export type CursorInput = { at: Date | string; id: string };
export type DecodedCursor = { at: Date; id: string };

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string): string | null {
  try {
    // Buffer.from accepts unpadded base64url directly in Node 18+, but we
    // also accept standard base64 (with +/=) to be lenient with clients
    // round-tripping cursors through URL decoders.
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function encodeCursor(input: CursorInput): string {
  const at = input.at instanceof Date ? input.at.toISOString() : new Date(input.at).toISOString();
  return toBase64Url(JSON.stringify({ at, id: input.id }));
}

export function decodeCursor(s: string): DecodedCursor | null {
  if (!s) return null;
  const json = fromBase64Url(s);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { at?: unknown; id?: unknown };
  if (typeof obj.at !== 'string' || typeof obj.id !== 'string') return null;
  const at = new Date(obj.at);
  if (Number.isNaN(at.getTime())) return null;
  return { at, id: obj.id };
}

export type PageInfo = { nextCursor: string | null; hasMore: boolean };

export type PaginateResult<T> = {
  data: T[];
  pageInfo: PageInfo;
};

// Convention: callers fetch `limit + 1` rows so paginate() can detect overflow
// without a second COUNT query. If we got more than `limit` we drop the extras
// and emit a cursor pointing at the LAST returned row.
export function paginate<T extends { id: string; createdAt: Date }>(args: {
  items: T[];
  limit: number;
}): PaginateResult<T> {
  const { items, limit } = args;
  if (limit <= 0) {
    return {
      data: [],
      pageInfo: { nextCursor: null, hasMore: items.length > 0 },
    };
  }
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null;
  return { data, pageInfo: { nextCursor, hasMore } };
}
