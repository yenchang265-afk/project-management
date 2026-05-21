// Unit tests for the email-notification worker. Transport is stubbed; we
// assert subject/body shape and that the worker handler completes.

import { describe, expect, it, vi } from 'vitest';

import { handleEmailJob } from '@/server/jobs/workers/emailNotification';

type StubTransport = {
  sendMail: ReturnType<typeof vi.fn>;
};

function makeTransport(): StubTransport {
  return { sendMail: vi.fn().mockResolvedValue({ accepted: ['x@y.com'] }) };
}

describe('email-notification worker', () => {
  it('sends an email with the correct subject and recipient', async () => {
    const transport = makeTransport();
    await handleEmailJob({
      job: {
        userId: 'u_1',
        kind: 'ISSUE_MENTIONED',
        payload: { issueKey: 'PROJ-42', issueTitle: 'Fix the thing' },
      },
      transport: transport as never,
      lookupRecipient: vi.fn().mockResolvedValue({ email: 'recipient@example.com', name: 'R' }),
      from: 'no-reply@pm.test',
    });

    expect(transport.sendMail).toHaveBeenCalledOnce();
    const arg = transport.sendMail.mock.calls[0]![0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(arg.from).toBe('no-reply@pm.test');
    expect(arg.to).toBe('recipient@example.com');
    expect(arg.subject).toBe('[PROJ-42] Fix the thing');
    expect(arg.html).toContain('PROJ-42');
  });

  it('falls back to a kind-based subject when issueTitle is missing', async () => {
    const transport = makeTransport();
    await handleEmailJob({
      job: {
        userId: 'u_1',
        kind: 'ISSUE_ASSIGNED',
        payload: { issueKey: 'PROJ-9' },
      },
      transport: transport as never,
      lookupRecipient: vi.fn().mockResolvedValue({ email: 'r@example.com', name: null }),
      from: 'no-reply@pm.test',
    });
    const arg = transport.sendMail.mock.calls[0]![0] as { subject: string };
    expect(arg.subject).toBe('[PROJ-9] You were assigned an issue');
  });

  it('no-ops when recipient lookup returns null', async () => {
    const transport = makeTransport();
    await handleEmailJob({
      job: { userId: 'u_ghost', kind: 'ISSUE_COMMENTED', payload: { issueKey: 'P-1' } },
      transport: transport as never,
      lookupRecipient: vi.fn().mockResolvedValue(null),
      from: 'no-reply@pm.test',
    });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('throws when transport.sendMail rejects (so pg-boss can retry)', async () => {
    const transport = { sendMail: vi.fn().mockRejectedValueOnce(new Error('smtp down')) };
    await expect(
      handleEmailJob({
        job: { userId: 'u_1', kind: 'ISSUE_MENTIONED', payload: { issueKey: 'P-1' } },
        transport: transport as never,
        lookupRecipient: vi.fn().mockResolvedValue({ email: 'r@example.com', name: null }),
        from: 'no-reply@pm.test',
      }),
    ).rejects.toThrow(/smtp down/);
  });
});
