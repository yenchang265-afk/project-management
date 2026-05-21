// Phase 4a — Boards route integration tests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedUsersAndProject,
  startIssuesIntegrationContext,
  stopIssuesIntegrationContext,
  withSession,
  type IssuesIntegrationContext,
  type TestUsers,
} from '../issues/__support__/setup';

const dockerAvailable = !!process.env.DOCKER_AVAILABLE;

describe.skipIf(!dockerAvailable)('boards routes', () => {
  let ctx: IssuesIntegrationContext;
  let u: TestUsers;

  beforeAll(async () => {
    ctx = await startIssuesIntegrationContext();
    u = await seedUsersAndProject('BRD');
  }, 240_000);

  afterAll(async () => {
    await stopIssuesIntegrationContext(ctx);
  });

  it('GET /board groups issues by status', async () => {
    // Seed three issues
    for (let i = 0; i < 3; i++) {
      await withSession(u.leadId, async () => {
        const { POST } = await import('@/../app/api/projects/[key]/issues/route');
        const r = await POST(
          new Request('http://localhost/api/projects/BRD/issues', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: `seed ${i}`, type: 'TASK' }),
          }),
          { params: Promise.resolve({ key: 'BRD' }) },
        );
        expect(r.status).toBe(201);
      });
    }
    // Move one to IN_PROGRESS
    await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/issues/[issueKey]/transition/route');
      const r = await POST(
        new Request('http://localhost/api/issues/BRD-1/transition', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'IN_PROGRESS' }),
        }),
        { params: Promise.resolve({ issueKey: 'BRD-1' }) },
      );
      expect(r.status).toBe(200);
    });

    const res = await withSession(u.leadId, async () => {
      const { GET } = await import('@/../app/api/projects/[key]/board/route');
      return GET(new Request('http://localhost/api/projects/BRD/board'), {
        params: Promise.resolve({ key: 'BRD' }),
      });
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      columns: Array<{ status: string; issues: Array<{ key: string }> }>;
    };
    expect(body.columns.map((c) => c.status)).toEqual(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
    const wip = body.columns.find((c) => c.status === 'IN_PROGRESS')!;
    expect(wip.issues.find((i) => i.key === 'BRD-1')).toBeTruthy();
  });

  it('POST /board/move performs valid transition', async () => {
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/board/move/route');
      return POST(
        new Request('http://localhost/api/projects/BRD/board/move', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ issueKey: 'BRD-2', toStatus: 'IN_PROGRESS' }),
        }),
        { params: Promise.resolve({ key: 'BRD' }) },
      );
    });
    expect(res.status).toBe(200);
  });

  it('POST /board/move rejects illegal transition with 422', async () => {
    const res = await withSession(u.leadId, async () => {
      const { POST } = await import('@/../app/api/projects/[key]/board/move/route');
      return POST(
        new Request('http://localhost/api/projects/BRD/board/move', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ issueKey: 'BRD-3', toStatus: 'DONE' }),
        }),
        { params: Promise.resolve({ key: 'BRD' }) },
      );
    });
    expect(res.status).toBe(422);
  });

  it('outsider gets 403 on board', async () => {
    const res = await withSession(u.outsiderId, async () => {
      const { GET } = await import('@/../app/api/projects/[key]/board/route');
      return GET(new Request('http://localhost/api/projects/BRD/board'), {
        params: Promise.resolve({ key: 'BRD' }),
      });
    });
    expect(res.status).toBe(403);
  });
});
