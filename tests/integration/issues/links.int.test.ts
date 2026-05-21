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

describe.skipIf(!dockerAvailable)('issue links via routes', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;
  let aKey: string;
  let bKey: string;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('ILNK');
    for (let i = 0; i < 2; i++) {
      const r = await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/projects/[key]/issues/route');
        return POST(
          new Request('http://localhost/api/projects/ILNK/issues', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: `i${i}`, type: 'TASK' }),
          }),
          { params: Promise.resolve({ key: 'ILNK' }) },
        );
      });
      const { issue } = (await r.json()) as { issue: { key: string } };
      if (i === 0) aKey = issue.key;
      else bKey = issue.key;
    }
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('links and unlinks', async () => {
    const linkRes = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/links/route');
      return POST(
        new Request(`http://localhost/api/issues/${aKey}/links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toKey: bKey, type: 'BLOCKS' }),
        }),
        { params: Promise.resolve({ issueKey: aKey }) },
      );
    });
    expect(linkRes.status).toBe(201);
    const { link } = (await linkRes.json()) as { link: { id: string } };

    const unlinkRes = await withSession(u.leadId, async () => {
      const { DELETE } = await import('@/../app/api/issues/links/[linkId]/route');
      return DELETE(
        new Request(`http://localhost/api/issues/links/${link.id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ linkId: link.id }) },
      );
    });
    expect(unlinkRes.status).toBe(204);
  });

  it('rejects self-link (400)', async () => {
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/links/route');
      return POST(
        new Request(`http://localhost/api/issues/${aKey}/links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toKey: aKey, type: 'RELATES_TO' }),
        }),
        { params: Promise.resolve({ issueKey: aKey }) },
      );
    });
    expect(res.status).toBe(400);
  });
});
