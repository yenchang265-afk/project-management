// pg-boss queue wrapper (Phase 4c).
//
// Design constraints:
//   - Singleton client per process — `pg-boss` opens its own connection pool.
//   - Lazy start: do not connect to Postgres until something actually
//     enqueues a job or registers a worker. This keeps unit tests fast and
//     allows the Next.js app to boot without Postgres reachable (the rest
//     of the app degrades gracefully).
//   - Defensive: a failed `boss.start()` (e.g. no DATABASE_URL in tests)
//     must log and degrade — never crash the host process.
//   - Test injection: __setJobsClientForTesting accepts a stub conforming to
//     the minimal subset of the pg-boss surface we use, so unit tests don't
//     load the real driver.

import type { NotificationKind } from '@prisma/client';

export const EMAIL_NOTIFICATION_QUEUE = 'email-notification';

export type EmailNotificationJob = {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

export type JobsClient = {
  start: () => Promise<unknown>;
  send: (queue: string, data: unknown, opts?: unknown) => Promise<string | null>;
  work: (queue: string, handler: (job: unknown) => Promise<unknown> | unknown) => Promise<unknown>;
  stop: (opts?: unknown) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => unknown;
  createQueue?: (queue: string, opts?: unknown) => Promise<unknown>;
};

let injected: JobsClient | null = null;
let real: JobsClient | null = null;
let started = false;
let starting: Promise<boolean> | null = null;

/**
 * Replace the underlying pg-boss client with a stub. Test-only.
 */
export function __setJobsClientForTesting(client: JobsClient | null): void {
  injected = client;
  started = false;
  starting = null;
}

export function __resetJobsForTesting(): void {
  injected = null;
  real = null;
  started = false;
  starting = null;
}

async function loadRealClient(): Promise<JobsClient | null> {
  if (real) return real;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const mod = (await import('pg-boss')) as unknown as {
      PgBoss?: new (cs: string) => JobsClient;
      default?: new (cs: string) => JobsClient;
    };
    const Ctor = mod.PgBoss ?? mod.default;
    if (!Ctor) return null;
    real = new Ctor(url);
    real.on?.('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[pg-boss] error', err);
    });
    return real;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pg-boss] failed to load', err);
    return null;
  }
}

export async function getJobsClient(): Promise<JobsClient | null> {
  if (injected) return injected;
  return loadRealClient();
}

async function ensureStarted(client: JobsClient): Promise<boolean> {
  if (started) return true;
  if (starting) return starting;
  starting = (async () => {
    try {
      await client.start();
      // Best-effort: ensure the queue exists. Older pg-boss versions don't
      // require this; newer ones (v10+) do.
      try {
        await client.createQueue?.(EMAIL_NOTIFICATION_QUEUE);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pg-boss] createQueue failed (continuing)', err);
      }
      started = true;
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pg-boss] start failed — queue disabled', err);
      starting = null;
      return false;
    }
  })();
  return starting;
}

export async function enqueueEmailNotification(
  job: EmailNotificationJob,
): Promise<{ enqueued: boolean; jobId: string | null }> {
  const client = await getJobsClient();
  if (!client) return { enqueued: false, jobId: null };
  const ok = await ensureStarted(client);
  if (!ok) return { enqueued: false, jobId: null };
  try {
    const jobId = await client.send(EMAIL_NOTIFICATION_QUEUE, job);
    return { enqueued: true, jobId: jobId ?? null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pg-boss] send failed', err);
    return { enqueued: false, jobId: null };
  }
}

export async function registerWorker(
  queue: string,
  handler: (job: { data: unknown }) => Promise<unknown> | unknown,
): Promise<boolean> {
  const client = await getJobsClient();
  if (!client) return false;
  const ok = await ensureStarted(client);
  if (!ok) return false;
  try {
    await client.work(queue, async (rawJob: unknown) => {
      // pg-boss v10 hands handlers an array of jobs; v9 hands a single job.
      // Normalize to { data } for our handler signature.
      const job = Array.isArray(rawJob) ? rawJob[0] : rawJob;
      const data = (job as { data?: unknown })?.data ?? job;
      return handler({ data });
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pg-boss] work registration failed', err);
    return false;
  }
}

export async function stopJobsClient(): Promise<void> {
  const client = injected ?? real;
  if (!client) return;
  try {
    await client.stop({ graceful: false });
  } catch {
    // ignore
  }
  started = false;
  starting = null;
}
