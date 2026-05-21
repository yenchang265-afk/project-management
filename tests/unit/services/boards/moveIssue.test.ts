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

describe('boards.moveIssueOnBoard', () => {
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

  it('moves issues across allowed transitions', async () => {
    const a = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const moved = await svc.moveIssueOnBoard(
      { issueKey: a.key, toStatus: 'IN_PROGRESS' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(moved.status).toBe('IN_PROGRESS');
  });

  it('rejects illegal transitions (delegating to issues service)', async () => {
    const a = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    // TODO → DONE is not allowed by issues transition matrix
    await expect(
      svc.moveIssueOnBoard(
        { issueKey: a.key, toStatus: 'DONE' },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects MEMBER from outside project', async () => {
    const a = await issues.createIssue(
      { projectKey: 'ALPHA', title: 'a', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.moveIssueOnBoard(
        { issueKey: a.key, toStatus: 'IN_PROGRESS' },
        { id: scaff.outsider.id, role: 'MEMBER' },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
