// Phase 4a — Board E2E. Golden path:
//   register → bump to LEAD → create project → create three issues →
//   open board → move TODO → IN_PROGRESS via click-to-move (drag is finicky
//   under Playwright with custom sensors) → reload → verify column →
//   save a filter → apply it.
//
// Skips when DATABASE_URL is unset (matches the convention from auth/issues e2e).

import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;

test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('board golden path', async ({ page }) => {
  const email = `board-e2e-${Date.now()}@example.com`;
  const password = 'pwd-1234-abcd';
  const key = `BE${Date.now().toString().slice(-6)}`;

  // Register
  await page.goto('/register');
  await page.fill('input[name="name"]', 'Board E2E');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Bump to LEAD via direct DB
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

  // Re-sign-in to pick up the role
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Create project
  await page.goto('/projects/new');
  await page.fill('input[name="key"]', key);
  await page.fill('input[name="name"]', 'Board E2E project');
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/projects/${key}`);

  // Create three issues
  for (let i = 0; i < 3; i++) {
    await page.goto(`/projects/${key}/issues/new`);
    await page.fill('[data-testid=issue-title-input]', `Card ${i + 1}`);
    await page.click('[data-testid=issue-create-submit]');
    await page.waitForURL(new RegExp(`/projects/${key}/issues/${key}-${i + 1}`));
  }

  // Open board
  await page.goto(`/projects/${key}/board`);
  await expect(page.getByTestId('board-columns')).toBeVisible();
  await expect(page.getByTestId(`board-card-${key}-1`)).toBeVisible();

  // Click-to-move card 1 to IN_PROGRESS (more deterministic than drag in CI)
  await page.click(`[data-testid=move-${key}-1-IN_PROGRESS]`);
  // Reload to verify persistence
  await page.reload();
  const wip = page.getByTestId('board-column-IN_PROGRESS');
  await expect(wip.getByTestId(`board-card-${key}-1`)).toBeVisible();

  // Save a filter via the dropdown
  await page.getByTestId('saved-filters-toggle').click();
  await page.fill('[data-testid=saved-filter-name]', 'Board view');
  await page.click('[data-testid=save-filter-submit]');

  // Re-open dropdown and apply
  await page.getByTestId('saved-filters-toggle').click();
  await expect(page.getByText('Board view')).toBeVisible();
});
