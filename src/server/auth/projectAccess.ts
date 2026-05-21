// Pure module: project-access guard signature. Phase 1 ships the stub;
// Phase 2 will replace the body with a real ProjectMember lookup.

import type { Role } from '@prisma/client';

import { NotImplementedError } from '@/lib/errors';

export async function requireProjectAccess(_projectKey: string, _min: Role): Promise<never> {
  throw new NotImplementedError('requireProjectAccess is implemented in Phase 2');
}
