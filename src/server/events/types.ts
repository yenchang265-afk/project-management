// Typed event names for the in-process domain event bus.
//
// Phase 3 emits these; Phase 4c (Notifications) and Phase 5a (Audit) subscribe.
// Keep the event NAMES stable — they are part of the public contract between
// vertical slices.

import type { IssueStatus, IssueType, IssuePriority, IssueLinkType } from '@prisma/client';

export const ISSUE_EVENTS = {
  CREATED: 'issue.created',
  UPDATED: 'issue.updated',
  TRANSITIONED: 'issue.transitioned',
  COMMENTED: 'issue.commented',
  MENTIONED: 'issue.mentioned',
  LINKED: 'issue.linked',
  ATTACHED: 'issue.attached',
  DELETED: 'issue.deleted',
} as const;

export type IssueEventName = (typeof ISSUE_EVENTS)[keyof typeof ISSUE_EVENTS];

export type IssueCreatedPayload = {
  issueId: string;
  issueKey: string;
  projectId: string;
  actorId: string;
  type: IssueType;
  priority: IssuePriority;
  assigneeId: string | null;
};

export type IssueUpdatedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
  field: string;
  before: string | null;
  after: string | null;
};

export type IssueTransitionedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
  from: IssueStatus;
  to: IssueStatus;
};

export type IssueCommentedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
  commentId: string;
};

export type IssueMentionedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
  commentId: string;
  mentionedUserId: string;
};

export type IssueLinkedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
  linkId: string;
  toIssueId: string;
  toIssueKey: string;
  type: IssueLinkType;
};

export type IssueAttachedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
  attachmentId: string;
  filename: string;
};

export type IssueDeletedPayload = {
  issueId: string;
  issueKey: string;
  actorId: string;
};

export type IssueEventPayloads = {
  [ISSUE_EVENTS.CREATED]: IssueCreatedPayload;
  [ISSUE_EVENTS.UPDATED]: IssueUpdatedPayload;
  [ISSUE_EVENTS.TRANSITIONED]: IssueTransitionedPayload;
  [ISSUE_EVENTS.COMMENTED]: IssueCommentedPayload;
  [ISSUE_EVENTS.MENTIONED]: IssueMentionedPayload;
  [ISSUE_EVENTS.LINKED]: IssueLinkedPayload;
  [ISSUE_EVENTS.ATTACHED]: IssueAttachedPayload;
  [ISSUE_EVENTS.DELETED]: IssueDeletedPayload;
};
