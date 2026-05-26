import { beforeEach, describe, expect, it } from 'vitest';

import { createIssuesService } from '@/server/services/issues';
import { reset } from '@/server/events/bus';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.getIssue', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('returns composed shape (labels, comments, attachments, links, activity)', async () => {
    const issue = await svc.createIssue(
      {
        projectKey: 'ALPHA',
        title: 'composed',
        type: 'TASK',
        labelNames: ['lbl'],
      },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await svc.addComment(
      issue.key,
      { body: 'hello world' },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    const out = await svc.getIssue(issue.key, { id: scaff.member.id, role: 'MEMBER' });
    expect(out.id).toBe(issue.id);
    expect(out.labels.map((l) => l.name)).toEqual(['lbl']);
    expect(out.comments).toHaveLength(1);
    expect(out.attachments).toEqual([]);
    expect(out.links).toEqual([]);
    expect(out.activity.length).toBeGreaterThan(0);
  });

  it('forbids non-members', async () => {
    const issue = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'x', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.getIssue(issue.key, { id: scaff.outsider.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('404s for missing issue', async () => {
    await expect(
      svc.getIssue('ALPHA-999', { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('400s on malformed key', async () => {
    await expect(
      svc.getIssue('NOHYPHEN', { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
