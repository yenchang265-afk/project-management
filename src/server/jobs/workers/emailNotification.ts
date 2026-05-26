// Email-notification worker (Phase 4c).
//
// Runs in the same Node process as the Next.js app in dev (called by
// src/server/bootstrap.ts) and in a standalone worker process in prod
// (src/server/jobs/bootstrap.ts). Tested in isolation by injecting a stubbed
// nodemailer transport via `handleEmailJob`.
//
// We render a tiny inline HTML body — no template engine. Subject format is
// `[{ISSUE_KEY}] {issueTitle or fallback}`. If we can't resolve the
// recipient (deleted user), we no-op rather than retry forever.

import type { Transporter } from 'nodemailer';
import type { NotificationKind } from '@prisma/client';

import { prisma } from '@/server/db';
import { EMAIL_NOTIFICATION_QUEUE, registerWorker } from '../queue';
import type { EmailNotificationJob } from '../queue';

export type EmailRecipient = { email: string; name: string | null };

export type EmailJobHandlerDeps = {
  job: EmailNotificationJob;
  transport: Pick<Transporter, 'sendMail'>;
  lookupRecipient: (userId: string) => Promise<EmailRecipient | null>;
  from: string;
};

function fallbackSubject(kind: NotificationKind, issueKey: string): string {
  switch (kind) {
    case 'ISSUE_ASSIGNED':
      return `[${issueKey}] You were assigned an issue`;
    case 'ISSUE_MENTIONED':
      return `[${issueKey}] You were mentioned`;
    case 'ISSUE_COMMENTED':
      return `[${issueKey}] New comment`;
    case 'ISSUE_TRANSITIONED':
      return `[${issueKey}] Status changed`;
    case 'ISSUE_CREATED_IN_WATCHED':
      return `[${issueKey}] New issue in a watched project`;
    case 'SPRINT_STARTED':
      return `[${issueKey}] Sprint started`;
    case 'SPRINT_COMPLETED':
      return `[${issueKey}] Sprint completed`;
    default:
      return `[${issueKey}] Update`;
  }
}

function renderHtml(job: EmailNotificationJob, issueKey: string, title: string): string {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  // We can't easily reconstruct the project key from the issue key without a
  // DB read; embed a best-effort link that the UI can resolve.
  const path = `/issues/${encodeURIComponent(issueKey)}`;
  return [
    '<!doctype html>',
    '<html><body style="font-family:system-ui,sans-serif">',
    `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`,
    `<p>${escapeHtml(describeKind(job.kind))}</p>`,
    `<p><a href="${baseUrl}${path}">Open ${escapeHtml(issueKey)}</a></p>`,
    '</body></html>',
  ].join('');
}

function describeKind(kind: NotificationKind): string {
  switch (kind) {
    case 'ISSUE_ASSIGNED':
      return 'You were assigned this issue.';
    case 'ISSUE_MENTIONED':
      return 'You were mentioned in a comment.';
    case 'ISSUE_COMMENTED':
      return 'A new comment was added.';
    case 'ISSUE_TRANSITIONED':
      return 'The status of this issue changed.';
    default:
      return 'You have a new notification.';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function handleEmailJob(deps: EmailJobHandlerDeps): Promise<void> {
  const { job, transport, lookupRecipient, from } = deps;
  const recipient = await lookupRecipient(job.userId);
  if (!recipient) return;

  const payload = job.payload as { issueKey?: unknown; issueTitle?: unknown };
  const issueKey = typeof payload.issueKey === 'string' ? payload.issueKey : 'PM';
  const issueTitle = typeof payload.issueTitle === 'string' ? payload.issueTitle : null;
  // Strip CR/LF to prevent SMTP header injection via a crafted issue title.
  const rawSubject = issueTitle
    ? `[${issueKey}] ${issueTitle}`
    : fallbackSubject(job.kind, issueKey);
  const subject = rawSubject.replace(/[\r\n]+/g, ' ');
  const html = renderHtml(job, issueKey, issueTitle ?? describeKind(job.kind));

  try {
    await transport.sendMail({
      from,
      to: recipient.email,
      subject,
      html,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[email-worker] sendMail failed', { userId: job.userId, kind: job.kind }, err);
    throw err;
  }
}

// Real-world registration. Called by jobs/bootstrap (or the in-process dev
// bootstrap). Lazy-imports nodemailer so the unit-test path never touches it.
export async function registerEmailWorker(): Promise<boolean> {
  const nodemailer = await import('nodemailer').catch(() => null);
  if (!nodemailer) {
    // eslint-disable-next-line no-console
    console.warn('[email-worker] nodemailer not installed — skipping registration');
    return false;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
  });
  const from = process.env.EMAIL_FROM ?? 'no-reply@projects.local';

  return registerWorker(EMAIL_NOTIFICATION_QUEUE, async (job) => {
    await handleEmailJob({
      job: job.data as EmailNotificationJob,
      transport,
      lookupRecipient: async (userId) => {
        const u = await prisma.user.findUnique({ where: { id: userId } });
        return u ? { email: u.email, name: u.name } : null;
      },
      from,
    });
  });
}
