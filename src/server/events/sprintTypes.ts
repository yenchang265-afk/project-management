// Typed event names for the in-process domain event bus — Sprints (Phase 4b).
//
// Lives in its own file so Phase 4c (Notifications) can edit `types.ts`
// in parallel without merge conflicts. Keep the event NAMES stable — they are
// part of the public contract between vertical slices.

import type { SprintState } from '@prisma/client';

export const SPRINT_EVENTS = {
  CREATED: 'sprint.created',
  STARTED: 'sprint.started',
  COMPLETED: 'sprint.completed',
  ISSUE_ADDED: 'sprint.issue_added',
  ISSUE_REMOVED: 'sprint.issue_removed',
} as const;

export type SprintEventName = (typeof SPRINT_EVENTS)[keyof typeof SPRINT_EVENTS];

export type SprintCreatedPayload = {
  sprintId: string;
  projectId: string;
  actorId: string;
  name: string;
  state: SprintState;
};

export type SprintStartedPayload = {
  sprintId: string;
  projectId: string;
  actorId: string;
  startDate: Date;
  endDate: Date | null;
};

export type SprintCompletedPayload = {
  sprintId: string;
  projectId: string;
  actorId: string;
  completedAt: Date;
  movedBackIssueIds: string[];
};

export type SprintIssueAddedPayload = {
  sprintId: string;
  projectId: string;
  actorId: string;
  issueId: string;
  issueKey: string;
  rank: number;
};

export type SprintIssueRemovedPayload = {
  sprintId: string;
  projectId: string;
  actorId: string;
  issueId: string;
  issueKey: string;
};

export type SprintEventPayloads = {
  [SPRINT_EVENTS.CREATED]: SprintCreatedPayload;
  [SPRINT_EVENTS.STARTED]: SprintStartedPayload;
  [SPRINT_EVENTS.COMPLETED]: SprintCompletedPayload;
  [SPRINT_EVENTS.ISSUE_ADDED]: SprintIssueAddedPayload;
  [SPRINT_EVENTS.ISSUE_REMOVED]: SprintIssueRemovedPayload;
};
