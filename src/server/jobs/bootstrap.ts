// Job worker bootstrap (Phase 4c).
//
// Two callers:
//   - `npm run jobs:worker` (a dedicated Node process) calls `startWorkers()`
//     to spin up pg-boss and register the email worker.
//   - In dev (next dev), the app process also calls `startWorkers()` via
//     `src/server/bootstrap.ts` so a separate worker process isn't required.
//
// All errors are caught — the app must boot even if pg-boss can't reach
// Postgres (e.g. local unit-test runs, sandboxed CI).

import { registerEmailWorker } from './workers/emailNotification';

let registered = false;

export async function startWorkers(): Promise<void> {
  if (registered) return;
  registered = true;
  try {
    await registerEmailWorker();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[jobs/bootstrap] failed to register workers', err);
  }
}

// Allow running as a standalone process: `tsx src/server/jobs/bootstrap.ts`
if (require.main === module) {
  void startWorkers().then(() => {
    // eslint-disable-next-line no-console
    console.info('[jobs/bootstrap] workers running (Ctrl-C to stop)');
  });
}
