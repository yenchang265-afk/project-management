// E2E for Phase 4b — Sprints. Golden path:
//   register → bump to LEAD → create project →
//   create 3 issues → plan a sprint → add issues →
//   start → transition one to DONE → complete →
//   verify the burndown endpoint returns data.
//
// Skips when DATABASE_URL is unavailable (CI brings up Postgres).

import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;

test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('sprint golden path', async ({ page, request }) => {
  const email = `sprint-e2e-${Date.now()}@example.com`;
  const password = 'pwd-1234-abcd';
  const key = `SE${Date.now().toString().slice(-6)}`;

  await page.goto('/register');
  await page.fill('input[name="name"]', 'Sprint E2E');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Bump to LEAD via direct DB write (same pattern as the issues e2e).
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('user not found');
    await prisma.orgMembership.upsert({
      where: { userId: user.id },
      update: { role: 'LEAD' },
      create: { userId: user.id, role: 'LEAD' },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Re-sign in so the JWT carries the new role.
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Create project
  await page.goto('/projects/new');
  await page.fill('input[name="key"]', key);
  await page.fill('input[name="name"]', 'Sprint E2E project');
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/projects/${key}`);

  // Create three issues.
  for (let n = 1; n <= 3; n++) {
    await page.goto(`/projects/${key}/issues/new`);
    await page.fill('[data-testid=issue-title-input]', `Issue ${n}`);
    await page.click('[data-testid=issue-create-submit]');
    await page.waitForURL(new RegExp(`/projects/${key}/issues/${key}-${n}`));
  }

  // Plan a sprint.
  await page.goto(`/projects/${key}/sprints/new`);
  await page.fill('[data-testid=sprint-name-input]', 'Sprint 1');
  await page.click('[data-testid=sprint-create-submit]');
  await page.waitForURL(new RegExp(`/projects/${key}/sprints/`));

  // Add all 3 issues from the backlog picker.
  for (let n = 1; n <= 3; n++) {
    await page.click(`[data-testid=sprint-add-${key}-${n}]`);
    // Wait for the row to disappear from the backlog (router refresh).
    await expect(page.locator(`[data-testid=sprint-add-${key}-${n}]`)).toHaveCount(0, {
      timeout: 5000,
    });
  }

  // Start the sprint — UI redirects to /active-sprint after start.
  await page.click('[data-testid=sprint-start]');
  await page.waitForURL(`**/projects/${key}/active-sprint`);

  // Transition issue #1 to DONE: TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
  await page.goto(`/projects/${key}/issues/${key}-1`);
  await page.click('[data-testid=transition-IN_PROGRESS]');
  await page.click('[data-testid=transition-IN_REVIEW]');
  await page.click('[data-testid=transition-DONE]');
  await expect(page.getByTestId('issue-status')).toHaveText('DONE');

  // Navigate to active sprint, complete it.
  await page.goto(`/projects/${key}/active-sprint`);
  await expect(page.getByTestId('active-sprint-board')).toBeVisible();

  // The complete button lives on the detail page.
  // Pull the sprint id from the link href.
  const detailHref = await page.getByRole('link', { name: /Sprint detail/ }).getAttribute('href');
  expect(detailHref).toBeTruthy();
  await page.goto(detailHref!);
  await page.click('[data-testid=sprint-complete]');
  await expect(page.getByTestId('sprint-state')).toHaveText('COMPLETED');

  // Burndown endpoint returns data.
  const sprintId = detailHref!.split('/').pop()!;
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await request.get(`/api/sprints/${sprintId}/burndown`, {
    headers: { cookie: cookieHeader },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { series: Array<{ date: string; remaining: number }> };
  expect(Array.isArray(body.series)).toBe(true);
});
