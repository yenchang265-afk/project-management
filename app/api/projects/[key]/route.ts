// GET /api/projects/[key]    — fetch project + viewerRole.
// PATCH /api/projects/[key]  — rename (requires LEAD on project).

import { NextResponse } from 'next/server';

import { AuthError } from '@/lib/errors';
import { WRITE_LIMIT, withRateLimit, writeUserKey } from '@/lib/rateLimit/middleware';
import { prisma } from '@/server/db';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { createProjectsService } from '@/server/services/projects';

function errorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    const status =
      err.code === 'unauthenticated'
        ? 401
        : err.code === 'forbidden'
          ? 403
          : err.code === 'not_found'
            ? 404
            : err.code === 'duplicate_key'
              ? 409
              : 400;
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
  }
  // eslint-disable-next-line no-console
  console.error('projects [key] route error', err);
  return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const { key } = await params;
    const { project, role } = await requireProjectAccess(key, 'VIEWER');
    return NextResponse.json({ project, viewerRole: role });
  } catch (err) {
    return errorResponse(err);
  }
}

async function patchHandler(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
  }
  try {
    const { key } = await params;
    const { project, user, role } = await requireProjectAccess(key, 'LEAD');
    const svc = createProjectsService({ prisma });
    const input = body as { name?: unknown; description?: unknown };
    const updated = await svc.renameProject(
      project.id,
      {
        name: input.name !== undefined ? String(input.name) : undefined,
        description:
          input.description !== undefined
            ? input.description === null
              ? null
              : String(input.description)
            : undefined,
      },
      { id: user.id, role },
    );
    return NextResponse.json({ project: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export const PATCH = withRateLimit({ keyFn: writeUserKey, limit: WRITE_LIMIT }, patchHandler);
