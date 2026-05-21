// GET /api/sprints/[id] — read a sprint (with composed board view if active).

import { AuthError } from '@/lib/errors';
import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db';
import { createSprintsService } from '@/server/services/sprints';
import { ok, toErrorResponse } from '@/lib/http';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const actor = await requireUser();
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new AuthError('not_found', `Sprint ${id} not found`);
    const project = await prisma.project.findUnique({ where: { id: sprint.projectId } });
    if (!project) throw new AuthError('not_found', 'Project not found');
    const svc = createSprintsService({ prisma });
    // VIEWER+ check via listSprints reuse — load all to validate access, but
    // we only need this one sprint with its issues.
    await svc.listSprints(project.key, { id: actor.id, role: actor.role });
    const links = await prisma.sprintIssue.findMany({
      where: { sprintId: sprint.id },
      orderBy: { rank: 'asc' },
    });
    const ids = links.map((l) => l.issueId);
    const issues = ids.length ? await prisma.issue.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(issues.map((i) => [i.id, i]));
    const ordered = links
      .map((l) => {
        const i = byId.get(l.issueId);
        return i ? { ...i, rank: l.rank } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return ok({ sprint, projectKey: project.key, issues: ordered });
  } catch (err) {
    return toErrorResponse(err);
  }
}
