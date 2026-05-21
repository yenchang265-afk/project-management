import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService, parseMentions } from '@/server/services/issues';
import { on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.addComment', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
  });

  it('creates a comment, emits issue.commented, writes activity entry', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'c', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.COMMENTED, handler);
    const c = await svc.addComment(
      i.key,
      { body: 'hello' },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    expect(c.body).toBe('hello');
    expect(handler).toHaveBeenCalledOnce();
    const log = await prisma.activityLogEntry.findMany({ where: { issueId: i.id } });
    expect(log.some((e) => e.field === 'comment.added')).toBe(true);
  });

  it('emits issue.mentioned per mentioned project member (resolved by email local-part)', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'c', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.MENTIONED, handler);
    // members are: lead@e.com (local "lead"), member@e.com (local "member")
    await svc.addComment(
      i.key,
      { body: 'hey @member can you look? cc @lead' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    // lead is the actor → should NOT mention self
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({
      mentionedUserId: scaff.member.id,
    });
  });

  it('does not emit issue.mentioned for non-project users', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'c', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.MENTIONED, handler);
    // outsider@e.com has local "outsider" but is not a project member
    await svc.addComment(
      i.key,
      { body: '@outsider you cannot see this' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects empty body', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'c', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.addComment(i.key, { body: '' }, { id: scaff.lead.id, role: 'LEAD' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('parseMentions extracts handles', () => {
    expect(parseMentions('hello @alice and @bob, also @bob again')).toEqual(['alice', 'bob']);
    expect(parseMentions('email@example.com should not match (no leading space)')).toEqual([]);
    expect(parseMentions('@first')).toEqual(['first']);
  });
});
