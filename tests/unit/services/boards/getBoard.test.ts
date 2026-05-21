import { beforeEach, describe, expect, it } from 'vitest';

import { AuthError } from '@/lib/errors';
import { createBoardsService } from '@/server/services/boards';
import { createIssuesService } from '@/server/services/issues';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from '../issues/__support__/fakePrisma';

describe('boards.getBoard', () => {
  let prisma: FakePrisma;
  let issues: ReturnType<typeof createIssuesService>;
  let svc: ReturnType<typeof createBoardsService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    issues = createIssuesService({ prisma: prisma as never });
    svc = createBoardsService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('groups issues by status with all four columns', async () => {
    const a = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'todo', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const b = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'wip', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await issues.transitionIssue(b.key, 'IN_PROGRESS', { id: scaff.lead.id, role: 'LEAD' });

    const board = await svc.getBoard('ALPHA', { id: scaff.lead.id, role: 'LEAD' });
    expect(board.columns.map((c) => c.status)).toEqual([
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ]);
    const todo = board.columns.find((c) => c.status === 'TODO')!;
    const wip = board.columns.find((c) => c.status === 'IN_PROGRESS')!;
    expect(todo.issues.map((i) => i.id)).toContain(a.id);
    expect(wip.issues.map((i) => i.id)).toContain(b.id);
  });

  it('rejects non-members', async () => {
    await expect(
      svc.getBoard('ALPHA', { id: scaff.outsider.id, role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('exposes project metadata', async () => {
    const board = await svc.getBoard('ALPHA', { id: scaff.lead.id, role: 'LEAD' });
    expect(board.project.key).toBe('ALPHA');
  });
});
