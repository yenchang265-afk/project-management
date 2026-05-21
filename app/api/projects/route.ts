// Project list + create endpoints. Thin shims over the projects service.

import { NextResponse } from 'next/server';

import { AuthError } from '@/lib/errors';
import { prisma } from '@/server/db';
import { requireUser, requireUserWithRole } from '@/server/auth/guards';
import { hasRoleAtLeast } from '@/server/auth/roles';
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
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status },
    );
  }
  // eslint-disable-next-line no-console
  console.error('projects route error', err);
  return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
  }
  try {
    const actor = await requireUserWithRole('LEAD');
    const svc = createProjectsService({ prisma });
    const input = body as {
      key?: unknown;
      name?: unknown;
      description?: unknown;
      leadId?: unknown;
    };
    const project = await svc.createProject(
      {
        key: String(input.key ?? ''),
        name: String(input.name ?? ''),
        description:
          input.description !== undefined && input.description !== null
            ? String(input.description)
            : undefined,
        leadId: input.leadId ? String(input.leadId) : actor.id,
      },
      { id: actor.id, role: actor.role },
    );
    return NextResponse.json({ id: project.id, key: project.key }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const actor = await requireUser();
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get('includeArchived') === 'true';
    if (includeArchived && !hasRoleAtLeast(actor.role, 'LEAD')) {
      throw new AuthError('forbidden', 'includeArchived requires LEAD');
    }
    const svc = createProjectsService({ prisma });
    const projects = await svc.listProjects(
      { id: actor.id, role: actor.role },
      { includeArchived },
    );
    return NextResponse.json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}
