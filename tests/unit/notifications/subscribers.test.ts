// Unit tests for subscribers: emit issue events on the real bus, assert which
// notificationService.createNotification calls happened (service is stubbed).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emit, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import {
  registerNotificationSubscribers,
  __resetNotificationSubscribers,
} from '@/server/services/notifications/subscribers';

type FakeSvc = {
  createNotification: ReturnType<typeof vi.fn>;
  addWatcher: ReturnType<typeof vi.fn>;
  listWatchers: ReturnType<typeof vi.fn>;
};

function makeSvc(overrides: Partial<FakeSvc> = {}): FakeSvc {
  return {
    createNotification: vi.fn().mockResolvedValue(null),
    addWatcher: vi.fn().mockResolvedValue(undefined),
    listWatchers: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeIssueLookup(opts: { reporterId: string; assigneeId: string | null }) {
  return vi.fn().mockResolvedValue({ reporterId: opts.reporterId, assigneeId: opts.assigneeId });
}

describe('notification subscribers', () => {
  beforeEach(() => {
    reset();
    __resetNotificationSubscribers();
  });

  it('issue.created notifies reporter (and assignee if different)', async () => {
    const svc = makeSvc();
    const lookup = makeIssueLookup({ reporterId: 'u_reporter', assigneeId: 'u_assignee' });
    registerNotificationSubscribers({ service: svc, lookupIssue: lookup });

    emit(ISSUE_EVENTS.CREATED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      projectId: 'p_1',
      actorId: 'u_reporter',
      type: 'TASK',
      priority: 'MEDIUM',
      assigneeId: 'u_assignee',
    });
    await new Promise((r) => setTimeout(r, 0));

    const calls = svc.createNotification.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'u_assignee', kind: 'ISSUE_ASSIGNED' }),
      ]),
    );
    // Reporter is the actor — we don't self-notify on creation.
    expect(calls.every((c) => c.userId !== 'u_reporter')).toBe(true);
    expect(svc.addWatcher).toHaveBeenCalledWith('i_1', 'u_reporter');
    expect(svc.addWatcher).toHaveBeenCalledWith('i_1', 'u_assignee');
  });

  it('issue.updated assigneeId notifies new assignee and adds them as watcher', async () => {
    const svc = makeSvc();
    const lookup = makeIssueLookup({ reporterId: 'u_reporter', assigneeId: 'u_new' });
    registerNotificationSubscribers({ service: svc, lookupIssue: lookup });

    emit(ISSUE_EVENTS.UPDATED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      actorId: 'u_reporter',
      field: 'assigneeId',
      before: null,
      after: 'u_new',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(svc.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u_new', kind: 'ISSUE_ASSIGNED' }),
    );
    expect(svc.addWatcher).toHaveBeenCalledWith('i_1', 'u_new');
  });

  it('issue.updated for non-assignee field does NOT notify', async () => {
    const svc = makeSvc();
    const lookup = makeIssueLookup({ reporterId: 'u_reporter', assigneeId: null });
    registerNotificationSubscribers({ service: svc, lookupIssue: lookup });

    emit(ISSUE_EVENTS.UPDATED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      actorId: 'u_reporter',
      field: 'title',
      before: 'a',
      after: 'b',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.createNotification).not.toHaveBeenCalled();
  });

  it('issue.transitioned notifies reporter + assignee + watchers (excluding actor)', async () => {
    const svc = makeSvc({
      listWatchers: vi.fn().mockResolvedValue(['u_watcher', 'u_actor']),
    });
    const lookup = makeIssueLookup({ reporterId: 'u_reporter', assigneeId: 'u_assignee' });
    registerNotificationSubscribers({ service: svc, lookupIssue: lookup });

    emit(ISSUE_EVENTS.TRANSITIONED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      actorId: 'u_actor',
      from: 'TODO',
      to: 'IN_PROGRESS',
    });
    await new Promise((r) => setTimeout(r, 0));

    const recipients = svc.createNotification.mock.calls.map((c) => c[0].userId);
    expect(new Set(recipients)).toEqual(new Set(['u_reporter', 'u_assignee', 'u_watcher']));
    expect(recipients).not.toContain('u_actor');
    for (const call of svc.createNotification.mock.calls) {
      expect(call[0].kind).toBe('ISSUE_TRANSITIONED');
    }
  });

  it('issue.commented notifies reporter + assignee + watchers (excluding actor)', async () => {
    const svc = makeSvc({
      listWatchers: vi.fn().mockResolvedValue(['u_watcher']),
    });
    const lookup = makeIssueLookup({ reporterId: 'u_reporter', assigneeId: 'u_actor' });
    registerNotificationSubscribers({ service: svc, lookupIssue: lookup });

    emit(ISSUE_EVENTS.COMMENTED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      actorId: 'u_actor',
      commentId: 'c_1',
    });
    await new Promise((r) => setTimeout(r, 0));

    const recipients = svc.createNotification.mock.calls.map((c) => c[0].userId);
    expect(new Set(recipients)).toEqual(new Set(['u_reporter', 'u_watcher']));
    expect(svc.createNotification.mock.calls[0]![0].kind).toBe('ISSUE_COMMENTED');
  });

  it('issue.mentioned notifies the mentioned user', async () => {
    const svc = makeSvc();
    registerNotificationSubscribers({ service: svc, lookupIssue: vi.fn() });

    emit(ISSUE_EVENTS.MENTIONED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      actorId: 'u_actor',
      commentId: 'c_1',
      mentionedUserId: 'u_mentioned',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(svc.createNotification).toHaveBeenCalledOnce();
    expect(svc.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u_mentioned', kind: 'ISSUE_MENTIONED' }),
    );
  });

  it('is idempotent — calling register twice does not double-subscribe', async () => {
    const svc = makeSvc();
    registerNotificationSubscribers({ service: svc, lookupIssue: vi.fn() });
    registerNotificationSubscribers({ service: svc, lookupIssue: vi.fn() });

    emit(ISSUE_EVENTS.MENTIONED, {
      issueId: 'i_1',
      issueKey: 'P-1',
      actorId: 'u_actor',
      commentId: 'c_1',
      mentionedUserId: 'u_mentioned',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.createNotification).toHaveBeenCalledOnce();
  });
});
