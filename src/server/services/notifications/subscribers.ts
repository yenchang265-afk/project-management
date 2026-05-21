// Notification event subscribers (Phase 4c).
//
// Wires the in-process event bus emitted by the issues service into the
// notifications service. Call `registerNotificationSubscribers()` ONCE on
// app startup (see src/server/bootstrap.ts). Repeated calls are idempotent.
//
// The subscribers are deliberately fire-and-forget — they catch their own
// errors so a misbehaving subscriber cannot crash a mutation. Async work
// (DB reads, queue enqueue) is awaited inside the handler but errors are
// logged, not propagated.
//
// Sprint event subscribers are guarded with try/catch and a TODO. Phase 4b
// may not have shipped those event constants by the time this code runs;
// importing them directly would create a phase-ordering coupling.

import { on } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import type {
  IssueCommentedPayload,
  IssueCreatedPayload,
  IssueMentionedPayload,
  IssueTransitionedPayload,
  IssueUpdatedPayload,
} from '@/server/events/types';

import type { NotificationService } from './index';

export type IssueLookup = (issueId: string) => Promise<{
  reporterId: string;
  assigneeId: string | null;
} | null>;

export type SubscriberDeps = {
  service: Pick<NotificationService, 'createNotification' | 'addWatcher' | 'listWatchers'>;
  lookupIssue: IssueLookup;
};

let registered = false;
const unsubscribers: Array<() => void> = [];

export function __resetNotificationSubscribers(): void {
  while (unsubscribers.length > 0) {
    const off = unsubscribers.pop();
    try {
      off?.();
    } catch {
      // ignore
    }
  }
  registered = false;
}

function logError(where: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[notifications/subscribers] ${where}`, err);
}

export function registerNotificationSubscribers(deps: SubscriberDeps): void {
  if (registered) return;
  registered = true;
  const { service, lookupIssue } = deps;

  // ---- issue.created ----
  unsubscribers.push(
    on<IssueCreatedPayload>(ISSUE_EVENTS.CREATED, async (payload) => {
      try {
        // Auto-watch: reporter (actor) and assignee.
        await service.addWatcher(payload.issueId, payload.actorId);
        if (payload.assigneeId) {
          await service.addWatcher(payload.issueId, payload.assigneeId);
        }
        // Notify assignee if different from actor.
        if (payload.assigneeId && payload.assigneeId !== payload.actorId) {
          await service.createNotification({
            userId: payload.assigneeId,
            kind: 'ISSUE_ASSIGNED',
            payload: {
              issueKey: payload.issueKey,
              actorId: payload.actorId,
            },
          });
        }
      } catch (err) {
        logError('issue.created', err);
      }
    }),
  );

  // ---- issue.updated (assignee changes only) ----
  unsubscribers.push(
    on<IssueUpdatedPayload>(ISSUE_EVENTS.UPDATED, async (payload) => {
      if (payload.field !== 'assigneeId') return;
      if (!payload.after) return; // unassigned → don't notify
      try {
        await service.addWatcher(payload.issueId, payload.after);
        if (payload.after === payload.actorId) return;
        await service.createNotification({
          userId: payload.after,
          kind: 'ISSUE_ASSIGNED',
          payload: {
            issueKey: payload.issueKey,
            actorId: payload.actorId,
          },
        });
      } catch (err) {
        logError('issue.updated', err);
      }
    }),
  );

  // ---- issue.transitioned ----
  unsubscribers.push(
    on<IssueTransitionedPayload>(ISSUE_EVENTS.TRANSITIONED, async (payload) => {
      try {
        const recipients = await collectRecipients(
          payload.issueId,
          payload.actorId,
          lookupIssue,
          service.listWatchers,
        );
        for (const userId of recipients) {
          await service.createNotification({
            userId,
            kind: 'ISSUE_TRANSITIONED',
            payload: {
              issueKey: payload.issueKey,
              actorId: payload.actorId,
              from: payload.from,
              to: payload.to,
            },
          });
        }
      } catch (err) {
        logError('issue.transitioned', err);
      }
    }),
  );

  // ---- issue.commented ----
  unsubscribers.push(
    on<IssueCommentedPayload>(ISSUE_EVENTS.COMMENTED, async (payload) => {
      try {
        const recipients = await collectRecipients(
          payload.issueId,
          payload.actorId,
          lookupIssue,
          service.listWatchers,
        );
        for (const userId of recipients) {
          await service.createNotification({
            userId,
            kind: 'ISSUE_COMMENTED',
            payload: {
              issueKey: payload.issueKey,
              actorId: payload.actorId,
              commentId: payload.commentId,
            },
          });
        }
      } catch (err) {
        logError('issue.commented', err);
      }
    }),
  );

  // ---- issue.mentioned ----
  unsubscribers.push(
    on<IssueMentionedPayload>(ISSUE_EVENTS.MENTIONED, async (payload) => {
      try {
        if (payload.mentionedUserId === payload.actorId) return;
        await service.createNotification({
          userId: payload.mentionedUserId,
          kind: 'ISSUE_MENTIONED',
          payload: {
            issueKey: payload.issueKey,
            actorId: payload.actorId,
            commentId: payload.commentId,
          },
        });
      } catch (err) {
        logError('issue.mentioned', err);
      }
    }),
  );

  // ---- sprint events ----
  // TODO(phase-4b): wire `sprint.started` / `sprint.completed` once 4b ships
  // its event constants. We deliberately don't import 4b's types here to keep
  // 4c independently mergeable.
  try {
    const sprintEvents = (
      globalThis as { __SPRINT_EVENTS__?: { STARTED?: string; COMPLETED?: string } }
    ).__SPRINT_EVENTS__;
    if (sprintEvents?.STARTED) {
      unsubscribers.push(
        on(sprintEvents.STARTED, async () => {
          // No-op stub: 4b will provide payload shape; until then we don't
          // know which users to notify. Left intentionally inert.
        }),
      );
    }
    if (sprintEvents?.COMPLETED) {
      unsubscribers.push(
        on(sprintEvents.COMPLETED, async () => {
          // No-op stub — see above.
        }),
      );
    }
  } catch (err) {
    logError('sprint-stub', err);
  }
}

async function collectRecipients(
  issueId: string,
  actorId: string,
  lookupIssue: IssueLookup,
  listWatchers: NotificationService['listWatchers'],
): Promise<string[]> {
  const info = await lookupIssue(issueId);
  const watchers = await listWatchers(issueId);
  const set = new Set<string>();
  if (info?.reporterId) set.add(info.reporterId);
  if (info?.assigneeId) set.add(info.assigneeId);
  for (const w of watchers) set.add(w);
  set.delete(actorId);
  return Array.from(set);
}
