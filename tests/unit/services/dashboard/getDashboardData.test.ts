// Unit tests for the dashboard read-model service.
// Failing first; service comes next. See IMPLEMENTATION_PLAN §9d.

import { beforeEach, describe, expect, it } from 'vitest';

import { createDashboardService } from '@/server/services/dashboard';
import {
  createFakePrisma,
  seedActivity,
  seedIssue,
  seedMember,
  seedProject,
  seedUser,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('dashboard.getDashboardData', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createDashboardService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    svc = createDashboardService({ prisma: prisma as never });
  });

  it('returns empty sections when the actor has no project access', async () => {
    const user = await seedUser(prisma, 'lonely@example.com');
    const result = await svc.getDashboardData({ id: user.id, role: 'MEMBER' });
    expect(result.assignedToMe).toEqual([]);
    expect(result.recentActivity).toEqual([]);
    expect(result.projectTiles).toEqual([]);
  });

  it('assignedToMe excludes DONE issues and limits to 10', async () => {
    const me = await seedUser(prisma, 'me@example.com');
    const project = await seedProject(prisma, 'AAA', me.id);
    await seedMember(prisma, project.id, me.id, 'MEMBER');

    // 12 non-DONE issues assigned to me, plus 1 DONE
    for (let i = 0; i < 12; i++) {
      // stagger createdAt so order is deterministic — newest last
      await seedIssue(prisma, project.id, project.key, {
        title: `open ${i}`,
        reporterId: me.id,
        assigneeId: me.id,
        status: 'IN_PROGRESS',
        createdAt: new Date(2024, 0, i + 1),
      });
    }
    await seedIssue(prisma, project.id, project.key, {
      title: 'closed',
      reporterId: me.id,
      assigneeId: me.id,
      status: 'DONE',
      createdAt: new Date(2024, 0, 20),
    });

    const result = await svc.getDashboardData({ id: me.id, role: 'MEMBER' });
    expect(result.assignedToMe).toHaveLength(10);
    for (const issue of result.assignedToMe) {
      expect(issue.status).not.toBe('DONE');
      expect(issue.assigneeId).toBe(me.id);
    }
    // newest first (created on day 12 should be first)
    expect(result.assignedToMe[0]?.title).toBe('open 11');
  });

  it('assignedToMe ignores issues from projects the actor cannot access', async () => {
    const me = await seedUser(prisma, 'me2@example.com');
    const other = await seedUser(prisma, 'lead@example.com');
    const accessible = await seedProject(prisma, 'ACC', me.id);
    await seedMember(prisma, accessible.id, me.id, 'MEMBER');
    const hidden = await seedProject(prisma, 'HID', other.id);
    // me is NOT a member of `hidden`

    await seedIssue(prisma, accessible.id, accessible.key, {
      title: 'visible',
      reporterId: me.id,
      assigneeId: me.id,
    });
    await seedIssue(prisma, hidden.id, hidden.key, {
      title: 'hidden',
      reporterId: other.id,
      assigneeId: me.id, // somehow assigned but not a member
    });

    const result = await svc.getDashboardData({ id: me.id, role: 'MEMBER' });
    expect(result.assignedToMe.map((i) => i.title)).toEqual(['visible']);
  });

  it('recentActivity scopes to projects the actor can access; limit 20', async () => {
    const me = await seedUser(prisma, 'me3@example.com');
    const other = await seedUser(prisma, 'other@example.com');
    const accessible = await seedProject(prisma, 'VIS', me.id);
    await seedMember(prisma, accessible.id, me.id, 'LEAD');
    const hidden = await seedProject(prisma, 'NOO', other.id);

    const vis = await seedIssue(prisma, accessible.id, accessible.key, {
      title: 'in-scope',
      reporterId: me.id,
    });
    const inv = await seedIssue(prisma, hidden.id, hidden.key, {
      title: 'out-of-scope',
      reporterId: other.id,
    });

    // 25 activity entries on accessible issue
    for (let i = 0; i < 25; i++) {
      await seedActivity(prisma, {
        issueId: vis.id,
        actorId: me.id,
        field: 'status',
        before: 'TODO',
        after: 'IN_PROGRESS',
        at: new Date(2024, 1, i + 1),
      });
    }
    // and one on the hidden one — must NOT appear
    await seedActivity(prisma, {
      issueId: inv.id,
      actorId: other.id,
      field: 'created',
      at: new Date(2024, 1, 30),
    });

    const result = await svc.getDashboardData({ id: me.id, role: 'LEAD' });
    expect(result.recentActivity).toHaveLength(20);
    for (const entry of result.recentActivity) {
      expect(entry.issueKey).toBe(vis.key);
      expect(entry.issueTitle).toBe('in-scope');
      expect(entry.actorName).toBe(me.name);
    }
    // newest first
    expect(result.recentActivity[0]?.at.getTime()).toBeGreaterThan(
      result.recentActivity[19]!.at.getTime(),
    );
  });

  it('projectTiles report openIssues count and doneThisWeek from recent DONE transitions', async () => {
    const me = await seedUser(prisma, 'me4@example.com', 'Lead Person');
    const project = await seedProject(prisma, 'CNT', me.id);
    await seedMember(prisma, project.id, me.id, 'LEAD');

    // 3 open (one TODO, one IN_PROGRESS, one IN_REVIEW), 2 DONE
    await seedIssue(prisma, project.id, project.key, {
      title: 'a',
      reporterId: me.id,
      status: 'TODO',
    });
    await seedIssue(prisma, project.id, project.key, {
      title: 'b',
      reporterId: me.id,
      status: 'IN_PROGRESS',
    });
    await seedIssue(prisma, project.id, project.key, {
      title: 'c',
      reporterId: me.id,
      status: 'IN_REVIEW',
    });
    const d1 = await seedIssue(prisma, project.id, project.key, {
      title: 'd1',
      reporterId: me.id,
      status: 'DONE',
    });
    const d2 = await seedIssue(prisma, project.id, project.key, {
      title: 'd2',
      reporterId: me.id,
      status: 'DONE',
    });

    // d1 transitioned to DONE 2 days ago — counts
    await seedActivity(prisma, {
      issueId: d1.id,
      actorId: me.id,
      field: 'status',
      before: 'IN_REVIEW',
      after: 'DONE',
      at: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    });
    // d2 transitioned to DONE 10 days ago — out of window
    await seedActivity(prisma, {
      issueId: d2.id,
      actorId: me.id,
      field: 'status',
      before: 'IN_REVIEW',
      after: 'DONE',
      at: new Date(Date.now() - 10 * 24 * 3600 * 1000),
    });

    const result = await svc.getDashboardData({ id: me.id, role: 'LEAD' });
    expect(result.projectTiles).toHaveLength(1);
    const tile = result.projectTiles[0]!;
    expect(tile.key).toBe('CNT');
    expect(tile.name).toBe('CNT');
    expect(tile.leadName).toBe('Lead Person');
    expect(tile.openIssues).toBe(3);
    expect(tile.doneThisWeek).toBe(1);
  });

  it('ADMIN sees every non-archived project as a tile, regardless of membership', async () => {
    const admin = await seedUser(prisma, 'admin@example.com');
    const lead = await seedUser(prisma, 'lead2@example.com');
    const p1 = await seedProject(prisma, 'AA', lead.id);
    const p2 = await seedProject(prisma, 'BB', lead.id);
    // admin has no ProjectMember rows
    await seedIssue(prisma, p1.id, p1.key, {
      title: 'x',
      reporterId: lead.id,
      status: 'TODO',
    });
    await seedIssue(prisma, p2.id, p2.key, {
      title: 'y',
      reporterId: lead.id,
      status: 'TODO',
    });

    const result = await svc.getDashboardData({ id: admin.id, role: 'ADMIN' });
    expect(result.projectTiles.map((t) => t.key).sort()).toEqual(['AA', 'BB']);
  });

  it('omits archived projects from tiles', async () => {
    const me = await seedUser(prisma, 'me5@example.com');
    const active = await seedProject(prisma, 'ACT', me.id);
    await seedMember(prisma, active.id, me.id, 'LEAD');
    const archived = await seedProject(prisma, 'ARC', me.id, true);
    await seedMember(prisma, archived.id, me.id, 'LEAD');

    const result = await svc.getDashboardData({ id: me.id, role: 'MEMBER' });
    expect(result.projectTiles.map((t) => t.key)).toEqual(['ACT']);
  });
});
