// Unit tests for the pg-boss queue wrapper. The real pg-boss is replaced by
// a stub via __setJobsClientForTesting so we never hit Postgres in unit
// tests. We do verify the singleton / lazy-start contract.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __setJobsClientForTesting,
  __resetJobsForTesting,
  enqueueEmailNotification,
  getJobsClient,
} from '@/server/jobs/queue';

type StubBoss = {
  start: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  work: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  createQueue: ReturnType<typeof vi.fn>;
};

function makeStub(): StubBoss {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('job_1'),
    work: vi.fn().mockResolvedValue('worker_1'),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    createQueue: vi.fn().mockResolvedValue(undefined),
  };
}

describe('jobs/queue', () => {
  beforeEach(() => {
    __resetJobsForTesting();
  });

  it('lazy-starts and sends the email job to the right queue', async () => {
    const stub = makeStub();
    __setJobsClientForTesting(stub as never);

    await enqueueEmailNotification({
      userId: 'u_1',
      kind: 'ISSUE_MENTIONED',
      payload: { issueKey: 'P-1' },
    });

    expect(stub.start).toHaveBeenCalledOnce();
    expect(stub.send).toHaveBeenCalledOnce();
    expect(stub.send.mock.calls[0]![0]).toBe('email-notification');
    expect(stub.send.mock.calls[0]![1]).toMatchObject({
      userId: 'u_1',
      kind: 'ISSUE_MENTIONED',
    });
  });

  it('only starts the underlying client once', async () => {
    const stub = makeStub();
    __setJobsClientForTesting(stub as never);

    await enqueueEmailNotification({
      userId: 'u_1',
      kind: 'ISSUE_MENTIONED',
      payload: {},
    });
    await enqueueEmailNotification({
      userId: 'u_2',
      kind: 'ISSUE_COMMENTED',
      payload: {},
    });
    expect(stub.start).toHaveBeenCalledOnce();
    expect(stub.send).toHaveBeenCalledTimes(2);
  });

  it('does not crash when the underlying client fails to start — logs and degrades', async () => {
    const stub = makeStub();
    stub.start.mockRejectedValueOnce(new Error('connection refused'));
    __setJobsClientForTesting(stub as never);

    const result = await enqueueEmailNotification({
      userId: 'u_1',
      kind: 'ISSUE_MENTIONED',
      payload: {},
    });
    expect(result.enqueued).toBe(false);
    expect(stub.send).not.toHaveBeenCalled();
  });

  it('getJobsClient returns the injected stub', async () => {
    const stub = makeStub();
    __setJobsClientForTesting(stub as never);
    const client = await getJobsClient();
    expect(client).toBe(stub);
  });
});
