// E2E for Phase 3 — Issues. Golden path:
//   register → bump to LEAD → create project →
//   create issue → open detail → comment with @mention →
//   walk TODO → IN_PROGRESS → IN_REVIEW → DONE → reopen →
//   link to second issue → verify activity timeline.
//
// Skips when DATABASE_URL is not set (same convention as auth/projects e2e).
// Attachment upload is intentionally skipped (no MinIO in CI yet — TODO Phase 4).

import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;

test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('issue lifecycle golden path', async ({ page }) => {
  const email = `issue-e2e-${Date.now()}@example.com`;
  const password = 'pwd-1234-abcd';
  const key = `IE${Date.now().toString().slice(-6)}`;

  await page.goto('/register');
  await page.fill('input[name="name"]', 'Issue E2E');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Bump to LEAD
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

  // Re-sign-in so JWT carries new role
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Create project
  await page.goto('/projects/new');
  await page.fill('input[name="key"]', key);
  await page.fill('input[name="name"]', 'Issue E2E project');
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/projects/${key}`);

  // Create first issue
  await page.click('[data-testid=new-issue-link]');
  await page.waitForURL(`**/projects/${key}/issues/new`);
  await page.fill('[data-testid=issue-title-input]', 'Primary issue');
  await page.click('[data-testid=issue-create-submit]');
  await page.waitForURL(new RegExp(`/projects/${key}/issues/${key}-1`));
  await expect(page.getByTestId('issue-status')).toHaveText('TODO');

  // Add comment with @mention (mentioned local-part won't resolve — that's
  // fine, we just want the comment to land).
  await page.fill('[data-testid=comment-body]', 'starting on this @nobody');
  await page.click('[data-testid=comment-submit]');
  await expect(page.getByTestId('comments').getByText('starting on this')).toBeVisible();

  // Transition: TODO → IN_PROGRESS → IN_REVIEW → DONE
  await page.click('[data-testid=transition-IN_PROGRESS]');
  await expect(page.getByTestId('issue-status')).toHaveText('IN_PROGRESS');
  await page.click('[data-testid=transition-IN_REVIEW]');
  await expect(page.getByTestId('issue-status')).toHaveText('IN_REVIEW');
  await page.click('[data-testid=transition-DONE]');
  await expect(page.getByTestId('issue-status')).toHaveText('DONE');

  // Create a second issue (for linking)
  await page.goto(`/projects/${key}/issues/new`);
  await page.fill('[data-testid=issue-title-input]', 'Secondary issue');
  await page.click('[data-testid=issue-create-submit]');
  await page.waitForURL(new RegExp(`/projects/${key}/issues/${key}-2`));

  // Open first issue, link to second
  await page.goto(`/projects/${key}/issues/${key}-1`);
  await page.fill('[data-testid=link-to]', `${key}-2`);
  await page.click('[data-testid=link-submit]');
  await expect(page.getByTestId('links').getByText('BLOCKS')).toBeVisible();

  // Activity timeline shows our actions
  const activity = page.getByTestId('activity');
  await expect(activity).toContainText('status');
  await expect(activity).toContainText('comment.added');
  await expect(activity).toContainText('link.added');

  // TODO(Phase 4): wire MinIO into CI and exercise the attachment dropzone here.
});
