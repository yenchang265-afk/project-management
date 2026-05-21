// Phase 2 implementation. Looks up the project by key, resolves the caller's
// effective role (max of org role and ProjectMember.role; ADMIN always wins),
// and enforces a minimum.

import type { Project, Role } from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { hasRoleAtLeast } from '@/server/auth/roles';
import { createProjectsService } from '@/server/services/projects';

export type ProjectAccessResult = {
  user: { id: string; email: string; name: string | null; role: Role };
  project: Project;
  role: Role;
};

export async function requireProjectAccess(
  projectKey: string,
  min: Role,
): Promise<ProjectAccessResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) {
    throw new AuthError('unauthenticated');
  }
  const orgRole = (session.user?.role as Role | undefined) ?? 'MEMBER';
  const user = {
    id: userId,
    email: session.user?.email ?? '',
    name: session.user?.name ?? null,
    role: orgRole,
  };

  const service = createProjectsService({ prisma });
  // getProjectByKey already enforces "must be a member OR ADMIN" and returns
  // the effective role. A NotFound bubbles up unchanged so the caller can map
  // it to a 404; a Forbidden surfaces from membership absence.
  const { project, viewerRole } = await service.getProjectByKey(projectKey, {
    id: userId,
    role: orgRole,
  });
  if (!hasRoleAtLeast(viewerRole, min)) {
    throw new AuthError('forbidden', `Requires role ${min} or higher on project ${projectKey}`);
  }
  return { user, project, role: viewerRole };
}
