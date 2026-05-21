// Regenerates docs/openapi.json from the in-process OpenAPI registry.
//
// Usage: `pnpm openapi` (defined in package.json).
// CI runs this in the same job that asserts `git diff --exit-code docs/openapi.json`,
// so the committed doc is always in sync with the registrations.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Side-effect import: every `registerOpenApiPath()` call lives in this module.
import '../src/lib/openapi/routes';

import { buildOpenApiDocument } from '../src/lib/openapi/registry';

function main(): void {
  const doc = buildOpenApiDocument();
  const outPath = join(process.cwd(), 'docs', 'openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  // Trailing newline keeps git diffs clean.
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}

main();
