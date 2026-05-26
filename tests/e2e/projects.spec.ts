// E2E: register fresh user → bump to LEAD via DB → create project → list shows it
// → open settings → archive → confirm hidden from default list.
//
// Skipped unless DATABASE_URL is set (same fallback rules as auth.spec.ts).
import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;

test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('create project, list, archive', async ({ page }) => {
  const email = `proj-e2e-${Date.now()}@example.com`;
  const password = 'pwd-1234-abcd';
  const key = `E2E${Date.now().toString().slice(-5)}`; // unique-ish, 2–10 chars

  // Register + auto sign-in
  await page.goto('/register');
  await page.fill('input[name="name"]', 'Proj E2E');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Bump this user to LEAD directly in the DB (no admin UI yet).
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

  // Sign out and back in so the JWT carries the new role.
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // Create the project
  await page.goto('/projects/new');
  await page.fill('input[name="key"]', key);
  await page.fill('input[name="name"]', 'My Project');
  await page.fill('textarea[name="description"]', 'created from e2e');
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/projects/${key}`);
  await expect(page.getByTestId('viewer-role')).toHaveText('LEAD');

  // List shows it
  await page.goto('/projects');
  await expect(page.getByTestId(`project-row-${key}`)).toBeVisible();

  // Archive via settings
  await page.goto(`/projects/${key}/settings`);
  await page.click('[data-testid=archive-project-button]');
  await page.waitForURL('**/projects');

  // Default list no longer shows it
  await expect(page.getByTestId(`project-row-${key}`)).toHaveCount(0);

  // includeArchived=true does
  await page.goto('/projects?includeArchived=true');
  await expect(page.getByTestId(`project-row-${key}`)).toBeVisible();
});
