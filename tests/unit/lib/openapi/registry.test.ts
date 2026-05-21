// Phase 5b OpenAPI registry — unit specs.
//
// The registry is a tiny side-effect-friendly accumulator: route handlers
// call `registerOpenApiPath(...)` at module load and the generator script
// stitches them into a single OpenAPI 3.1 document. We test:
//   - `registerOpenApiPath` round-trips one entry
//   - `buildOpenApiDocument()` emits a syntactically valid 3.1 doc
//   - `resetRegistry()` (test-only) clears prior state between specs

import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  buildOpenApiDocument,
  registerOpenApiPath,
  resetRegistryForTests,
} from '@/lib/openapi/registry';

describe('openapi registry', () => {
  beforeEach(() => {
    resetRegistryForTests();
  });

  it('registers a path and emits it in the generated doc', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/api/ping',
      summary: 'Ping',
      responses: {
        200: {
          description: 'pong',
          content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
        },
      },
    });
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info?.title).toBeTruthy();
    expect(doc.info?.version).toBeTruthy();
    expect(doc.paths?.['/api/ping']?.get?.summary).toBe('Ping');
  });

  it('accepts a request body and renders it in the doc', () => {
    registerOpenApiPath({
      method: 'post',
      path: '/api/echo',
      summary: 'Echo',
      request: {
        body: {
          content: {
            'application/json': { schema: z.object({ msg: z.string() }) },
          },
        },
      },
      responses: {
        200: {
          description: 'echoed',
          content: { 'application/json': { schema: z.object({ msg: z.string() }) } },
        },
      },
    });
    const doc = buildOpenApiDocument();
    const post = doc.paths?.['/api/echo']?.post;
    expect(post?.requestBody).toBeTruthy();
  });

  it('resetRegistryForTests() wipes prior registrations', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/api/first',
      responses: { 200: { description: 'ok' } },
    });
    resetRegistryForTests();
    const doc = buildOpenApiDocument();
    expect(doc.paths?.['/api/first']).toBeUndefined();
  });
});
