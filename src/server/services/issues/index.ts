// Issues domain service. Public contract consumed by Phase 4 slices
// (Boards / Sprints / Notifications / Dashboard) — keep these signatures
// stable; additive changes only.
//
// Responsibilities:
//   - Zod-validated input.
//   - RBAC via requireProjectAccess-style checks (we accept the resolved
//     `actor` from the route layer to keep the service pure / unit-testable).
//   - Atomic issue numbering via `nextIssueNumber` in a transaction.
//   - Activity log entries for every change.
//   - Domain events emitted on the in-process bus (see src/server/events/types.ts).
//
// Authorization helpers are inlined here instead of imported from the projects
// service so unit tests can drive everything through the fake Prisma.

import { z } from 'zod';
import type {
  Issue,
  IssueLink,
  IssueLinkType,
  IssuePriority,
  IssueStatus,
  IssueType,
  PrismaClient,
  Role,
  Attachment,
  Comment,
  Label,
} from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { ROLE_RANK, hasRoleAtLeast } from '@/server/auth/roles';
import { emit } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import { deleteObject as s3DeleteObject, presignGet, presignPut } from '@/server/storage/s3';

export { AuthError } from '@/lib/errors';

// ----- types -----

export type Actor = { id: string; role: Role };

export type IssuesServiceDeps = {
  prisma: PrismaClient;
};

// ----- transition rules -----
// Whitelist enforced in service.

const TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  TODO: ['IN_PROGRESS'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW'],
  IN_REVIEW: ['TODO', 'IN_PROGRESS', 'DONE'],
  DONE: ['TODO'],
};

export function isAllowedTransition(from: IssueStatus, to: IssueStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ----- input schemas -----

export const issueTypeSchema = z.enum(['TASK', 'BUG', 'STORY', 'EPIC']);
export const issuePrioritySchema = z.enum(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST']);
export const issueStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
export const issueLinkTypeSchema = z.enum(['BLOCKS', 'RELATES_TO', 'DUPLICATES']);

export const createIssueInputSchema = z.object({
  projectKey: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50_000).optional(),
  type: issueTypeSchema,
  priority: issuePrioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  dueDate: z.coerce.date().optional(),
  estimate: z.number().int().nonnegative().max(10_000).optional(),
  labelNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueInputSchema>;

export const updateIssueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(50_000).nullable().optional(),
    priority: issuePrioritySchema.optional(),
    type: issueTypeSchema.optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    estimate: z.number().int().nonnegative().max(10_000).nullable().optional(),
  })
  .strict();
export type UpdateIssueInput = z.infer<typeof updateIssueInputSchema>;

export const listIssuesInputSchema = z.object({
  projectKey: z.string().min(1),
  status: z.array(issueStatusSchema).optional(),
  assigneeId: z.string().optional(), // can be userId | 'me' | 'unassigned'
  labelNames: z.array(z.string()).optional(),
  priority: z.array(issuePrioritySchema).optional(),
  type: z.array(issueTypeSchema).optional(),
  query: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});
export type ListIssuesInput = z.infer<typeof listIssuesInputSchema>;

export const addCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
});
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;

export const linkIssuesInputSchema = z.object({
  fromKey: z.string().min(1),
  toKey: z.string().min(1),
  type: issueLinkTypeSchema,
});
export type LinkIssuesInput = z.infer<typeof linkIssuesInputSchema>;

// ----- constants -----

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
// text/html and image/svg+xml are intentionally excluded: HTML and SVG served
// from S3 can execute JavaScript when rendered inline by the browser, enabling
// stored XSS via presigned GET URLs. SVG is XML-based and supports <script>,
// onload= handlers, and javascript: hrefs regardless of Content-Disposition.
export const ALLOWED_MIME_BLOCKED = ['image/svg+xml', 'image/svg'];
export const ALLOWED_MIME_PREFIXES = ['image/'];
export const ALLOWED_MIME_EXACT = [
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/csv',
  'text/markdown',
];

function isAllowedMime(mime: string): boolean {
  if (ALLOWED_MIME_BLOCKED.includes(mime)) return false;
  return (
    ALLOWED_MIME_EXACT.includes(mime) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
  );
}

export const attachFileInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    // Validated at schema level so callers that bypass the service layer
    // (e.g. direct route-handler tests) still can't supply text/html,
    // image/svg+xml, or other types browsers render as active content
    // (stored XSS via presigned GET URLs).
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
  })
  .refine((v) => isAllowedMime(v.mimeType), {
    message: 'Unsupported MIME type',
    path: ['mimeType'],
  });
export type AttachFileInput = z.infer<typeof attachFileInputSchema>;

// ----- utilities -----

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AuthError('invalid_input', result.error.issues[0]?.message, result.error.flatten());
  }
  return result.data;
}

function projectKeyFromIssueKey(issueKey: string): string {
  const idx = issueKey.lastIndexOf('-');
  if (idx < 0) throw new AuthError('invalid_input', `Malformed issue key: "${issueKey}"`);
  return issueKey.slice(0, idx);
}

// Parse @mentions out of comment markdown. The regex matches `@username`
// preceded by whitespace or start-of-string. We resolve mentions by the
// user's email local-part (case-insensitive) for determinism — `User.name`
// is free-form and may collide.
const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9_.-]+)/g;

export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  const matches = body.matchAll(MENTION_RE);
  for (const m of matches) {
    if (m[1]) out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}

function maxRole(a: Role, b: Role): Role {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

// ----- factory -----

export function createIssuesService(deps: IssuesServiceDeps) {
  const { prisma } = deps;

  async function resolveProjectAccess(
    projectKey: string,
    min: Role,
    actor: Actor,
  ): Promise<{ project: { id: string; key: string }; viewerRole: Role }> {
    const project = await prisma.project.findUnique({ where: { key: projectKey } });
    if (!project) throw new AuthError('not_found', `Project "${projectKey}" not found`);
    let viewerRole: Role;
    if (actor.role === 'ADMIN') {
      viewerRole = 'ADMIN';
    } else {
      const member = await prisma.projectMember.findFirst({
        where: { projectId: project.id, userId: actor.id },
      });
      if (!member) {
        throw new AuthError('forbidden', `Not a member of project ${projectKey}`);
      }
      viewerRole = maxRole(actor.role, member.role);
    }
    if (!hasRoleAtLeast(viewerRole, min)) {
      throw new AuthError('forbidden', `Requires role ${min} or higher on project ${projectKey}`);
    }
    return { project: { id: project.id, key: project.key }, viewerRole };
  }

  async function assertProjectMember(projectId: string, userId: string): Promise<void> {
    const m = await prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (!m) {
      throw new AuthError('invalid_input', `User ${userId} is not a member of this project`);
    }
  }

  async function nextIssueNumberInternal(
    projectId: string,
    tx: { issueCounter: PrismaClient['issueCounter'] },
  ): Promise<number> {
    const result = await tx.issueCounter.update({
      where: { projectId },
      data: { lastNumber: { increment: 1 } },
    });
    return result.lastNumber;
  }

  async function resolveOrCreateLabels(
    projectId: string,
    names: string[],
    db: { label: PrismaClient['label']; issueLabel: PrismaClient['issueLabel'] } = prisma,
  ): Promise<Label[]> {
    const out: Label[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const label = (await db.label.upsert({
        where: { projectId_name: { projectId, name } },
        update: {},
        create: { projectId, name, color: '#999999' },
      })) as Label;
      out.push(label);
    }
    return out;
  }

  // -------- createIssue --------

  async function createIssue(input: CreateIssueInput, actor: Actor): Promise<Issue> {
    const data = parseOrThrow(createIssueInputSchema, input);
    const { project } = await resolveProjectAccess(data.projectKey, 'MEMBER', actor);

    if (data.assigneeId) {
      await assertProjectMember(project.id, data.assigneeId);
    }

    // Wrap counter-increment + issue create + label association in a single
    // transaction so a failure in any step rolls back all writes atomically.
    const issue = (await prisma.$transaction(async (tx) => {
      const number = await nextIssueNumberInternal(project.id, tx);
      const key = `${project.key}-${number}`;
      const created = (await tx.issue.create({
        data: {
          projectId: project.id,
          number,
          key,
          title: data.title,
          description: data.description ?? null,
          type: data.type,
          priority: data.priority ?? 'MEDIUM',
          status: 'TODO',
          assigneeId: data.assigneeId ?? null,
          reporterId: actor.id,
          dueDate: data.dueDate ?? null,
          estimate: data.estimate ?? null,
        },
      })) as Issue;
      if (data.labelNames && data.labelNames.length > 0) {
        const labels = await resolveOrCreateLabels(
          project.id,
          data.labelNames,
          tx as unknown as { label: PrismaClient['label']; issueLabel: PrismaClient['issueLabel'] },
        );
        for (const label of labels) {
          await tx.issueLabel.create({ data: { issueId: created.id, labelId: label.id } });
        }
      }
      return created;
    })) as Issue;

    await prisma.activityLogEntry.create({
      data: {
        issueId: issue.id,
        actorId: actor.id,
        field: 'created',
        before: null,
        after: issue.key,
      },
    });

    emit(ISSUE_EVENTS.CREATED, {
      issueId: issue.id,
      issueKey: issue.key,
      projectId: project.id,
      actorId: actor.id,
      type: issue.type,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
    });

    return issue;
  }

  // -------- getIssue (composed) --------

  type ComposedIssue = Issue & {
    labels: Label[];
    comments: Comment[];
    attachments: Attachment[];
    links: Array<IssueLink & { direction: 'from' | 'to' }>;
    activity: Array<{
      id: string;
      actorId: string;
      field: string;
      before: string | null;
      after: string | null;
      at: Date;
    }>;
  };

  async function getIssue(issueKey: string, actor: Actor): Promise<ComposedIssue> {
    const projectKey = projectKeyFromIssueKey(issueKey);
    await resolveProjectAccess(projectKey, 'VIEWER', actor);
    const issue = (await prisma.issue.findUnique({ where: { key: issueKey } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', `Issue ${issueKey} not found`);

    const labelRows = (await prisma.issueLabel.findMany({
      where: { issueId: issue.id },
      include: { label: true },
    })) as Array<{
      issueId: string;
      labelId: string;
      label: Label | null;
    }>;
    const labels: Label[] = labelRows.map((r) => r.label).filter((l): l is Label => l !== null);

    const comments = (await prisma.comment.findMany({
      where: { issueId: issue.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })) as Comment[];

    const attachments = (await prisma.attachment.findMany({
      where: { issueId: issue.id },
    })) as Attachment[];

    const fromLinks = (await prisma.issueLink.findMany({
      where: { fromIssueId: issue.id },
    })) as IssueLink[];
    const toLinks = (await prisma.issueLink.findMany({
      where: { toIssueId: issue.id },
    })) as IssueLink[];

    const activity = (await prisma.activityLogEntry.findMany({
      where: { issueId: issue.id },
      orderBy: { at: 'desc' },
      take: 50,
    })) as Array<{
      id: string;
      actorId: string;
      field: string;
      before: string | null;
      after: string | null;
      at: Date;
    }>;

    return {
      ...issue,
      labels,
      comments,
      attachments,
      links: [
        ...fromLinks.map((l) => ({ ...l, direction: 'from' as const })),
        ...toLinks.map((l) => ({ ...l, direction: 'to' as const })),
      ],
      activity,
    };
  }

  // -------- listIssues --------

  async function listIssues(
    input: ListIssuesInput,
    actor: Actor,
  ): Promise<{ data: Issue[]; pageInfo: { nextCursor: string | null; hasMore: boolean } }> {
    const data = parseOrThrow(listIssuesInputSchema, input);
    const { project } = await resolveProjectAccess(data.projectKey, 'VIEWER', actor);

    const where: {
      projectId: string;
      status?: { in: IssueStatus[] };
      priority?: { in: IssuePriority[] };
      type?: { in: IssueType[] };
      assigneeId?: string | null;
      title?: { contains: string; mode: 'insensitive' };
      labels?: { some: { label: { name: { in: string[] } } } };
    } = { projectId: project.id };

    if (data.status?.length) where.status = { in: data.status };
    if (data.priority?.length) where.priority = { in: data.priority };
    if (data.type?.length) where.type = { in: data.type };

    if (data.assigneeId === 'me') {
      where.assigneeId = actor.id;
    } else if (data.assigneeId === 'unassigned') {
      where.assigneeId = null;
    } else if (data.assigneeId) {
      where.assigneeId = data.assigneeId;
    }

    if (data.query) {
      where.title = { contains: data.query, mode: 'insensitive' };
    }

    if (data.labelNames?.length) {
      where.labels = { some: { label: { name: { in: data.labelNames } } } };
    }

    const limit = data.limit ?? 25;
    const findArgs: {
      where: typeof where;
      orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
      take: number;
      cursor?: { id: string };
      skip?: number;
    } = {
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    };
    if (data.cursor) {
      findArgs.cursor = { id: data.cursor };
      findArgs.skip = 1;
    }

    const rows = (await prisma.issue.findMany(findArgs)) as Issue[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    return { data: page, pageInfo: { nextCursor, hasMore } };
  }

  // -------- updateIssue --------

  const UPDATABLE_FIELDS: Array<keyof UpdateIssueInput> = [
    'title',
    'description',
    'priority',
    'type',
    'assigneeId',
    'dueDate',
    'estimate',
  ];

  function serializeFieldValue(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }

  async function updateIssue(
    issueKey: string,
    patch: UpdateIssueInput,
    actor: Actor,
  ): Promise<Issue> {
    const data = parseOrThrow(updateIssueInputSchema, patch);
    const projectKey = projectKeyFromIssueKey(issueKey);
    const { project } = await resolveProjectAccess(projectKey, 'MEMBER', actor);

    const issue = (await prisma.issue.findUnique({ where: { key: issueKey } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', `Issue ${issueKey} not found`);

    if (data.assigneeId) {
      await assertProjectMember(project.id, data.assigneeId);
    }

    const changes: Array<{ field: string; before: string | null; after: string | null }> = [];
    const updateData: Partial<Issue> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (!(field in data)) continue;
      const after = data[field] ?? null;
      const before = (issue as unknown as Record<string, unknown>)[field] ?? null;
      // shallow compare (Date → time)
      const sameDates =
        before instanceof Date && after instanceof Date && before.getTime() === after.getTime();
      const same = sameDates || before === after;
      if (same) continue;
      changes.push({
        field,
        before: serializeFieldValue(before),
        after: serializeFieldValue(after),
      });
      (updateData as Record<string, unknown>)[field] = after;
    }

    if (changes.length === 0) return issue;

    const updated = (await prisma.issue.update({
      where: { id: issue.id },
      data: updateData,
    })) as Issue;

    for (const c of changes) {
      await prisma.activityLogEntry.create({
        data: {
          issueId: issue.id,
          actorId: actor.id,
          field: c.field,
          before: c.before,
          after: c.after,
        },
      });
      emit(ISSUE_EVENTS.UPDATED, {
        issueId: issue.id,
        issueKey: issue.key,
        actorId: actor.id,
        field: c.field,
        before: c.before,
        after: c.after,
      });
    }

    return updated;
  }

  // -------- transitionIssue --------

  async function transitionIssue(
    issueKey: string,
    newStatus: IssueStatus,
    actor: Actor,
  ): Promise<Issue> {
    if (!issueStatusSchema.options.includes(newStatus)) {
      throw new AuthError('invalid_input', `Unknown status ${newStatus}`);
    }
    const projectKey = projectKeyFromIssueKey(issueKey);
    await resolveProjectAccess(projectKey, 'MEMBER', actor);

    const issue = (await prisma.issue.findUnique({ where: { key: issueKey } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', `Issue ${issueKey} not found`);
    const fromStatus = issue.status; // snapshot before update (fake may share refs)
    if (fromStatus === newStatus) return issue;
    if (!isAllowedTransition(fromStatus, newStatus)) {
      throw new AuthError('invalid_transition', `Cannot transition ${fromStatus} → ${newStatus}`);
    }
    const updated = (await prisma.issue.update({
      where: { id: issue.id },
      data: { status: newStatus },
    })) as Issue;

    await prisma.activityLogEntry.create({
      data: {
        issueId: issue.id,
        actorId: actor.id,
        field: 'status',
        before: fromStatus,
        after: newStatus,
      },
    });

    emit(ISSUE_EVENTS.TRANSITIONED, {
      issueId: issue.id,
      issueKey: issue.key,
      actorId: actor.id,
      from: fromStatus,
      to: newStatus,
    });

    return updated;
  }

  // -------- deleteIssue --------

  async function deleteIssue(issueKey: string, actor: Actor): Promise<void> {
    const projectKey = projectKeyFromIssueKey(issueKey);
    await resolveProjectAccess(projectKey, 'LEAD', actor);
    const issue = (await prisma.issue.findUnique({ where: { key: issueKey } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', `Issue ${issueKey} not found`);

    await prisma.issue.delete({ where: { id: issue.id } });

    emit(ISSUE_EVENTS.DELETED, {
      issueId: issue.id,
      issueKey: issue.key,
      actorId: actor.id,
    });
  }

  // -------- addComment --------

  async function addComment(
    issueKey: string,
    input: AddCommentInput,
    actor: Actor,
  ): Promise<Comment> {
    const data = parseOrThrow(addCommentInputSchema, input);
    const projectKey = projectKeyFromIssueKey(issueKey);
    const { project } = await resolveProjectAccess(projectKey, 'MEMBER', actor);

    const issue = (await prisma.issue.findUnique({ where: { key: issueKey } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', `Issue ${issueKey} not found`);

    const comment = (await prisma.comment.create({
      data: { issueId: issue.id, authorId: actor.id, body: data.body },
    })) as Comment;

    await prisma.activityLogEntry.create({
      data: {
        issueId: issue.id,
        actorId: actor.id,
        field: 'comment.added',
        before: null,
        after: comment.id,
      },
    });

    emit(ISSUE_EVENTS.COMMENTED, {
      issueId: issue.id,
      issueKey: issue.key,
      actorId: actor.id,
      commentId: comment.id,
    });

    // Resolve mentions: match by email local-part case-insensitively, and
    // restrict to project members so we don't broadcast to randos.
    const handles = parseMentions(data.body);
    if (handles.length > 0) {
      const projectUserIds = (
        (await prisma.projectMember.findMany({
          where: { projectId: project.id },
        })) as Array<{ userId: string }>
      ).map((m) => m.userId);
      if (projectUserIds.length > 0) {
        const users = (await prisma.user.findMany({
          where: { id: { in: projectUserIds } },
        })) as Array<{ id: string; email: string }>;
        const byHandle = new Map<string, string>();
        for (const u of users) {
          const local = (u.email.split('@')[0] ?? '').toLowerCase();
          if (local) byHandle.set(local, u.id);
        }
        for (const handle of handles) {
          const uid = byHandle.get(handle);
          if (!uid || uid === actor.id) continue;
          emit(ISSUE_EVENTS.MENTIONED, {
            issueId: issue.id,
            issueKey: issue.key,
            actorId: actor.id,
            commentId: comment.id,
            mentionedUserId: uid,
          });
        }
      }
    }

    return comment;
  }

  // -------- linkIssues --------

  async function linkIssues(input: LinkIssuesInput, actor: Actor): Promise<IssueLink> {
    const data = parseOrThrow(linkIssuesInputSchema, input);
    if (data.fromKey === data.toKey) {
      throw new AuthError('invalid_input', 'Cannot link an issue to itself');
    }
    const projectKey = projectKeyFromIssueKey(data.fromKey);
    const toProjectKey = projectKeyFromIssueKey(data.toKey);
    if (projectKey !== toProjectKey) {
      throw new AuthError('invalid_input', 'Cross-project links are not supported');
    }
    await resolveProjectAccess(projectKey, 'MEMBER', actor);
    const from = (await prisma.issue.findUnique({ where: { key: data.fromKey } })) as Issue | null;
    const to = (await prisma.issue.findUnique({ where: { key: data.toKey } })) as Issue | null;
    if (!from || !to) throw new AuthError('not_found', 'One or both issues not found');

    // dedupe — RELATES_TO and DUPLICATES are symmetric (A relates-to B ≡ B
    // relates-to A; A duplicates B ≡ B duplicates A). BLOCKS is directional.
    const isSymmetric = data.type === 'RELATES_TO' || data.type === 'DUPLICATES';
    const existing = (await prisma.issueLink.findFirst({
      where: isSymmetric
        ? {
            OR: [
              { fromIssueId: from.id, toIssueId: to.id, type: data.type },
              { fromIssueId: to.id, toIssueId: from.id, type: data.type },
            ],
          }
        : { fromIssueId: from.id, toIssueId: to.id, type: data.type },
    })) as IssueLink | null;
    if (existing) {
      throw new AuthError('conflict', 'Link already exists');
    }

    const link = (await prisma.issueLink.create({
      data: { fromIssueId: from.id, toIssueId: to.id, type: data.type as IssueLinkType },
    })) as IssueLink;

    await prisma.activityLogEntry.create({
      data: {
        issueId: from.id,
        actorId: actor.id,
        field: 'link.added',
        before: null,
        after: `${data.type}:${to.key}`,
      },
    });

    emit(ISSUE_EVENTS.LINKED, {
      issueId: from.id,
      issueKey: from.key,
      actorId: actor.id,
      linkId: link.id,
      toIssueId: to.id,
      toIssueKey: to.key,
      type: link.type,
    });

    return link;
  }

  async function unlinkIssues(linkId: string, actor: Actor): Promise<void> {
    const link = (await prisma.issueLink.findUnique({ where: { id: linkId } })) as IssueLink | null;
    if (!link) throw new AuthError('not_found', 'Link not found');
    const from = (await prisma.issue.findUnique({
      where: { id: link.fromIssueId },
    })) as Issue | null;
    if (!from) throw new AuthError('not_found', 'Originating issue gone');
    const projectKey = projectKeyFromIssueKey(from.key);
    await resolveProjectAccess(projectKey, 'MEMBER', actor);
    await prisma.issueLink.delete({ where: { id: linkId } });
    await prisma.activityLogEntry.create({
      data: {
        issueId: from.id,
        actorId: actor.id,
        field: 'link.removed',
        before: link.type,
        after: null,
      },
    });
  }

  // -------- attachments --------

  function buildStorageKey(projectId: string, issueId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    // cheap unique-ish — phase 3 doesn't need cuid here but use timestamp+rand
    const rand = Math.random().toString(36).slice(2, 10);
    return `${projectId}/${issueId}/${Date.now()}-${rand}-${safe}`;
  }

  async function attachFile(
    issueKey: string,
    input: AttachFileInput,
    actor: Actor,
  ): Promise<{ attachment: Attachment; uploadUrl: string }> {
    const data = parseOrThrow(attachFileInputSchema, input);
    if (data.size > MAX_ATTACHMENT_BYTES) {
      throw new AuthError('invalid_input', 'File exceeds 25MB limit');
    }
    if (!isAllowedMime(data.mimeType)) {
      throw new AuthError('invalid_input', `Unsupported MIME type: ${data.mimeType}`);
    }
    const projectKey = projectKeyFromIssueKey(issueKey);
    const { project } = await resolveProjectAccess(projectKey, 'MEMBER', actor);
    const issue = (await prisma.issue.findUnique({ where: { key: issueKey } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', `Issue ${issueKey} not found`);

    const storageKey = buildStorageKey(project.id, issue.id, data.filename);
    // Get the upload URL before writing to the DB. If presignPut fails, no
    // orphaned Attachment row is left behind.
    const uploadUrl = await presignPut(storageKey, data.mimeType);
    const attachment = (await prisma.attachment.create({
      data: {
        issueId: issue.id,
        uploaderId: actor.id,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        storageKey,
      },
    })) as Attachment;

    await prisma.activityLogEntry.create({
      data: {
        issueId: issue.id,
        actorId: actor.id,
        field: 'attachment.added',
        before: null,
        after: attachment.filename,
      },
    });

    emit(ISSUE_EVENTS.ATTACHED, {
      issueId: issue.id,
      issueKey: issue.key,
      actorId: actor.id,
      attachmentId: attachment.id,
      filename: attachment.filename,
    });

    return { attachment, uploadUrl };
  }

  async function getAttachmentDownloadUrl(attachmentId: string, actor: Actor): Promise<string> {
    const att = (await prisma.attachment.findUnique({
      where: { id: attachmentId },
    })) as Attachment | null;
    if (!att) throw new AuthError('not_found', 'Attachment not found');
    const issue = (await prisma.issue.findUnique({ where: { id: att.issueId } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', 'Parent issue missing');
    const projectKey = projectKeyFromIssueKey(issue.key);
    await resolveProjectAccess(projectKey, 'VIEWER', actor);
    return presignGet(att.storageKey, att.filename);
  }

  async function removeAttachment(attachmentId: string, actor: Actor): Promise<void> {
    const att = (await prisma.attachment.findUnique({
      where: { id: attachmentId },
    })) as Attachment | null;
    if (!att) throw new AuthError('not_found', 'Attachment not found');
    const issue = (await prisma.issue.findUnique({ where: { id: att.issueId } })) as Issue | null;
    if (!issue) throw new AuthError('not_found', 'Parent issue missing');
    const projectKey = projectKeyFromIssueKey(issue.key);
    const { viewerRole } = await resolveProjectAccess(projectKey, 'MEMBER', actor);
    if (att.uploaderId !== actor.id && !hasRoleAtLeast(viewerRole, 'LEAD')) {
      throw new AuthError(
        'forbidden',
        'Only the uploader or project LEAD can remove this attachment',
      );
    }
    await prisma.attachment.delete({ where: { id: attachmentId } });
    // best-effort S3 delete
    try {
      await s3DeleteObject(att.storageKey);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('failed to delete S3 object', att.storageKey, err);
    }
    await prisma.activityLogEntry.create({
      data: {
        issueId: issue.id,
        actorId: actor.id,
        field: 'attachment.removed',
        before: att.filename,
        after: null,
      },
    });
  }

  return {
    createIssue,
    getIssue,
    listIssues,
    updateIssue,
    transitionIssue,
    deleteIssue,
    addComment,
    linkIssues,
    unlinkIssues,
    attachFile,
    getAttachmentDownloadUrl,
    removeAttachment,
  };
}

export type IssuesService = ReturnType<typeof createIssuesService>;
