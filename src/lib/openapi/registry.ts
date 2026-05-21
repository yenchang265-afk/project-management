// OpenAPI 3.1 registry for Phase 5b.
//
// Each route handler module that wants to appear in `docs/openapi.json` calls
// `registerOpenApiPath(...)` at module load. The generator script in
// `scripts/generate-openapi.ts` does a side-effect import of every registered
// route module, then calls `buildOpenApiDocument()` to flatten the accumulated
// state into a single doc.
//
// We don't try to cover 100% of endpoints here — the goal is a working
// registry mechanism plus representative coverage. Future slices can append
// more registrations without changing this file.

import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Side-effect: adds `.openapi()` to every Zod schema. Idempotent.
extendZodWithOpenApi(z);

let registry = new OpenAPIRegistry();

export function registerOpenApiPath(route: RouteConfig): void {
  registry.registerPath(route);
}

export function registerOpenApiComponent<T extends z.ZodTypeAny>(name: string, schema: T): T {
  return registry.register(name, schema);
}

export type GeneratedDoc = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export function buildOpenApiDocument(): GeneratedDoc {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Project Management API',
      version: '0.1.0',
      description:
        'OpenAPI 3.1 contract for the project-management app. Generated from Zod schemas via `pnpm openapi`.',
    },
    servers: [{ url: '/', description: 'Same-origin' }],
  });
}

// Test helper. Production code should never call this — it wipes every
// registration made via side-effect imports.
export function resetRegistryForTests(): void {
  registry = new OpenAPIRegistry();
}
