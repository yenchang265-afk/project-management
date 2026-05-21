// Server-side bootstrap (Phase 4c).
//
// Imported by `app/layout.tsx` (server component) so on the first request
// for any page we initialize:
//   1. Notification event subscribers (in-process).
//   2. pg-boss workers (email).
//
// Both are idempotent and best-effort; failures must never crash a render.

import { prisma } from '@/server/db';
import { createNotificationService } from '@/server/services/notifications';
import { registerNotificationSubscribers } from '@/server/services/notifications/subscribers';
import { enqueueEmailNotification } from '@/server/jobs/queue';

let booted = false;

export function bootstrapServer(): void {
  if (booted) return;
  booted = true;

  try {
    const svc = createNotificationService({
      prisma,
      enqueueEmail: async (job) => {
        // Best-effort: enqueueEmailNotification already swallows errors and
        // returns { enqueued: false } on failure.
        await enqueueEmailNotification(job);
      },
    });
    registerNotificationSubscribers({
      service: svc,
      lookupIssue: async (issueId) => {
        const issue = await prisma.issue.findUnique({
          where: { id: issueId },
          select: { reporterId: true, assigneeId: true },
        });
        return issue ?? null;
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] subscriber registration failed', err);
  }

  // Best-effort worker registration. Real Postgres or stub is fine; if it
  // can't start (e.g. DATABASE_URL not set), pg-boss layer degrades silently.
  if (process.env.NODE_ENV !== 'test') {
    void (async () => {
      try {
        const { startWorkers } = await import('@/server/jobs/bootstrap');
        await startWorkers();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[bootstrap] worker startup failed', err);
      }
    })();
  }
}
