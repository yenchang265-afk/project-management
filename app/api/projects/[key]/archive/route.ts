// POST /api/projects/[key]/archive — archive a project. Idempotent.

import { NextResponse } from 'next/server';

import { AuthError } from '@/lib/errors';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';
import { prisma } from '@/server/db';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { createProjectsService } from '@/server/services/projects';

async function handler(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await params;
    const { project, user, role } = await requireProjectAccess(key, 'LEAD');
    const svc = createProjectsService({ prisma });
    const updated = await svc.archiveProject(project.id, { id: user.id, role });
    return NextResponse.json({ project: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      const status =
        err.code === 'unauthenticated'
          ? 401
          : err.code === 'forbidden'
            ? 403
            : err.code === 'not_found'
              ? 404
              : 400;
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
    }
    // eslint-disable-next-line no-console
    console.error('archive route error', err);
    return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
  }
}

export const POST = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, handler);
