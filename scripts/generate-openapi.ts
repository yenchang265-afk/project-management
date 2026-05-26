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

async function main(): Promise<void> {
  const doc = buildOpenApiDocument();
  const outPath = join(process.cwd(), 'docs', 'openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  const raw = JSON.stringify(doc, null, 2) + '\n';
  // Prettier-format so CI's `git diff --exit-code` doesn't trip when a
  // developer ran `prettier --write` locally. We pull prettier dynamically
  // so this script doesn't add a hard dep when only types are needed.
  let formatted = raw;
  try {
    const prettier: typeof import('prettier') =
      (await import('prettier')).default ?? (await import('prettier'));
    formatted = await prettier.format(raw, { parser: 'json' });
  } catch {
    // Fallback: write the raw output. CI will fail loudly if the format
    // drifts, but the OpenAPI doc itself is still valid.
  }
  writeFileSync(outPath, formatted, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}

void main();
