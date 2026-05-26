// E2E for Phase 4d — Dashboard.
//
// Golden path: register → bump to LEAD → create project → create issue
// assigned to self → transition to IN_PROGRESS → visit /dashboard → assert
// the issue surfaces under "Assigned to me" and an entry surfaces under
// "Recent activity".
//
// Skips when DATABASE_URL is unset (matches the other e2e specs).

import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;

test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('dashboard surfaces assigned issues and recent activity', async ({ page }) => {
  const email = `dash-e2e-${Date.now()}@example.com`;
  const password = 'pwd-1234-abcd';
  const key = `DE${Date.now().toString().slice(-6)}`;

  await page.goto('/register');
  await page.fill('input[name="name"]', 'Dash E2E');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Bump to LEAD
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let userId: string;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('user not found');
    userId = user.id;
    await prisma.orgMembership.upsert({
      where: { userId: user.id },
      update: { role: 'LEAD' },
      create: { userId: user.id, role: 'LEAD' },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Re-sign-in so JWT carries the new role
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Create project
  await page.goto('/projects/new');
  await page.fill('input[name="key"]', key);
  await page.fill('input[name="name"]', 'Dashboard project');
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/projects/${key}`);

  // Create issue assigned to self
  await page.goto(`/projects/${key}/issues/new`);
  await page.fill('[data-testid=issue-title-input]', 'Mine to do');
  // The form may not expose an explicit assignee selector; the simplest path
  // is to leave it unassigned, then set assignment via the API once the
  // issue exists. We hit the PATCH route directly so we don't depend on UI
  // affordances that may be Phase 5.
  await page.click('[data-testid=issue-create-submit]');
  await page.waitForURL(new RegExp(`/projects/${key}/issues/${key}-1`));

  // Assign to self via the issue route (using the session cookie Playwright
  // already holds). We re-use the page context's request handle.
  const res = await page.request.patch(`/api/issues/${key}-1`, {
    data: { assigneeId: userId! },
  });
  if (!res.ok()) throw new Error(`assign PATCH failed: ${res.status()}`);

  // Transition to IN_PROGRESS so activity log gets a status entry
  await page.goto(`/projects/${key}/issues/${key}-1`);
  await page.click('[data-testid=transition-IN_PROGRESS]');
  await expect(page.getByTestId('issue-status')).toHaveText('IN_PROGRESS');

  // Visit dashboard
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Assigned-to-me shows the issue
  const assigned = page.getByTestId('assigned-to-me');
  await expect(assigned.getByTestId(`assigned-issue-${key}-1`)).toBeVisible();
  await expect(assigned).toContainText('Mine to do');

  // Recent activity surfaces something for our project
  const activity = page.getByTestId('recent-activity');
  await expect(activity).toContainText(`${key}-1`);

  // Project tiles include our project with at least one open issue
  const tile = page.getByTestId(`project-tile-${key}`);
  await expect(tile).toBeVisible();
  await expect(page.getByTestId(`open-${key}`)).toHaveText(/[1-9]/);
});

test('root path redirects unauthenticated visitors to /login', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/login');
});
