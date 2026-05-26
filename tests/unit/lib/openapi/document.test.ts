// Sanity test for the generated OpenAPI 3.1 document.
//
// We avoid asserting every path here — that would be a maintenance trap.
// Instead we side-effect-import the routes module (same path the generator
// script uses) and verify the document has the OpenAPI 3.1 top-level fields
// plus at least the canonical endpoints listed in the Phase 5b plan.

import { describe, expect, it } from 'vitest';

// Side-effect: registers every route description.
import '@/lib/openapi/routes';

import { buildOpenApiDocument } from '@/lib/openapi/registry';

describe('buildOpenApiDocument()', () => {
  it('emits a syntactically valid OpenAPI 3.1 doc with required top-level fields', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toBeTruthy();
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
    expect(doc.paths).toBeTruthy();
  });

  it('registers the canonical Phase 5b endpoints', () => {
    const doc = buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    for (const expected of [
      '/api/auth/register',
      '/api/projects',
      '/api/projects/{key}/issues',
      '/api/issues/{issueKey}',
      '/api/issues/{issueKey}/comments',
      '/api/dashboard',
      '/api/notifications',
    ]) {
      expect(paths, `missing path ${expected}`).toContain(expected);
    }
  });

  it('exposes the shared ErrorEnvelope and PageInfo components', () => {
    const doc = buildOpenApiDocument();
    expect(doc.components?.schemas?.ErrorEnvelope).toBeTruthy();
    expect(doc.components?.schemas?.PageInfo).toBeTruthy();
  });
});
