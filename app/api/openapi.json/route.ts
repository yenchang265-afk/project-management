// GET /api/openapi.json — serves the OpenAPI 3.1 contract.
//
// Strategy:
//   - In production: read the committed doc from disk (cheap, no dependency
//     graph walk at request time, immutable per-deploy).
//   - In development: regenerate on the fly so changes to registrations
//     surface without re-running `pnpm openapi`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV !== 'production') {
    // Lazy import to keep the registry side-effect off the prod request path.
    await import('@/lib/openapi/routes');
    const { buildOpenApiDocument } = await import('@/lib/openapi/registry');
    const doc = buildOpenApiDocument();
    return NextResponse.json(doc, { status: 200 });
  }
  try {
    const raw = readFileSync(join(process.cwd(), 'docs', 'openapi.json'), 'utf8');
    return new NextResponse(raw, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'OpenAPI doc not generated yet' } },
      { status: 404 },
    );
  }
}
