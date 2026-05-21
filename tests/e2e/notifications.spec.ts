// E2E for Phase 4c — Notifications.
//   User A registers, becomes a LEAD, creates a project, invites user B.
//   A mentions B in a comment. B sees an in-app notification at
//   /api/notifications.
//
// Email assertion is skipped unless Mailpit is reachable. Like the rest of
// our e2e suite this is skipped when DATABASE_URL is missing.

import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;
test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('A @mentions B → B receives in-app notification', async ({ page, request, browser }) => {
  const ts = Date.now();
  const emailA = `n-a-${ts}@example.com`;
  const emailB = `n-b-${ts}@example.com`;
  const password = 'pwd-abcd-1234';
  const key = `NT${ts.toString().slice(-6)}`;

  // --- register A and bump to LEAD ---
  await page.goto('/register');
  await page.fill('input[name="name"]', 'User A');
  await page.fill('input[name="email"]', emailA);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let projectId: string;
  let userBId: string;
  try {
    const a = await prisma.user.findUnique({ where: { email: emailA } });
    if (!a) throw new Error('A missing');
    await prisma.orgMembership.upsert({
      where: { userId: a.id },
      update: { role: 'LEAD' },
      create: { userId: a.id, role: 'LEAD' },
    });

    // --- create project via API (logged in) ---
    const projRes = await request.post('/api/projects', {
      data: { key, name: key, leadId: a.id },
    });
    expect(projRes.status()).toBe(201);
    const project = await prisma.project.findUnique({ where: { key } });
    if (!project) throw new Error('project missing');
    projectId = project.id;

    // --- pre-create B and add as MEMBER ---
    const regB = await request.post('/api/auth/register', {
      data: { email: emailB, password, name: 'User B' },
    });
    expect(regB.status()).toBeLessThan(400);
    const b = await prisma.user.findUnique({ where: { email: emailB } });
    if (!b) throw new Error('B missing');
    userBId = b.id;
    await prisma.orgMembership.upsert({
      where: { userId: b.id },
      update: { role: 'MEMBER' },
      create: { userId: b.id, role: 'MEMBER' },
    });
    await prisma.projectMember.create({
      data: { projectId, userId: b.id, role: 'MEMBER' },
    });
  } finally {
    await prisma.$disconnect();
  }

  // --- A creates an issue and mentions B ---
  const issueRes = await request.post(`/api/projects/${key}/issues`, {
    data: { title: 'mention me', type: 'TASK' },
  });
  expect(issueRes.status()).toBe(201);
  const { issue } = (await issueRes.json()) as { issue: { key: string } };

  const handleB = emailB.split('@')[0]; // n-b-<ts>
  const commentRes = await request.post(`/api/issues/${issue.key}/comments`, {
    data: { body: `cc @${handleB}` },
  });
  expect(commentRes.status()).toBe(201);

  // Give subscribers a moment.
  await page.waitForTimeout(200);

  // --- log in as B (new context to swap session) ---
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    await pageB.goto('/login');
    await pageB.fill('input[name="email"]', emailB);
    await pageB.fill('input[name="password"]', password);
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL((url) => !url.pathname.startsWith('/login'));

    // Poll /api/notifications until ISSUE_MENTIONED shows up.
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      const res = await pageB.request.get('/api/notifications');
      if (res.ok()) {
        const body = (await res.json()) as {
          data: Array<{ kind: string; payload: { issueKey?: string } }>;
        };
        if (body.data.some((n) => n.kind === 'ISSUE_MENTIONED')) {
          found = true;
          break;
        }
      }
      await pageB.waitForTimeout(200);
    }
    expect(found).toBe(true);
  } finally {
    await ctxB.close();
  }
});
