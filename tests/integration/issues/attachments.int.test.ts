// Attachments via routes. We stub the S3 client so no real S3 traffic happens.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from './__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('attachments via routes', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;
  let issueKey: string;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('IATT');
    const { __setS3ClientForTesting } = await import('@/server/storage/s3');
    __setS3ClientForTesting({
      send: async () => undefined,
      presignPut: async (key: string) => `https://stub.test/put/${encodeURIComponent(key)}`,
      presignGet: async (key: string) => `https://stub.test/get/${encodeURIComponent(key)}`,
      deleteObject: async () => undefined,
    } as never);
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/issues/route');
      return POST(
        new Request('http://localhost/api/projects/IATT/issues', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'att', type: 'TASK' }),
        }),
        { params: Promise.resolve({ key: 'IATT' }) },
      );
    });
    const { issue } = (await res.json()) as { issue: { key: string } };
    issueKey = issue.key;
  }, 240_000);

  afterAll(async () => {
    const { __resetS3ClientForTesting } = await import('@/server/storage/s3');
    __resetS3ClientForTesting();
    await stopIssuesIntegrationContext(ctx);
  });

  it('returns a presigned upload URL', async () => {
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/attachments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filename: 'note.pdf',
            mimeType: 'application/pdf',
            size: 1024,
          }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { uploadUrl: string };
    expect(body.uploadUrl).toMatch(/^https:\/\/stub\.test\/put\//);
  });

  it('rejects oversized files', async () => {
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/attachments/route');
      return POST(
        new Request(`http://localhost/api/issues/${issueKey}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filename: 'big.pdf',
            mimeType: 'application/pdf',
            size: 26 * 1024 * 1024,
          }),
        }),
        { params: Promise.resolve({ issueKey }) },
      );
    });
    expect(res.status).toBe(400);
  });
});
