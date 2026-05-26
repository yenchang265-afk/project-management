// E2E: register → login → profile → logout → reset password → login again.
//
// The reset email isn't reachable from the plain CI workflow (no Mailpit),
// so we fall back to reading the token directly from the DB via Prisma.
// Skipped entirely unless DATABASE_URL is set.
import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;

test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('register, login, edit profile, reset password', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'first-pwd-1234';
  const newPassword = 'second-pwd-5678';

  // Register
  await page.goto('/register');
  await page.fill('input[name="name"]', 'E2E User');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');

  // Should land on /profile after auto sign-in.
  await page.waitForURL('**/profile');
  await expect(page.getByTestId('profile-email')).toHaveText(email);

  // Edit name
  await page.fill('input[name="name"]', 'Updated E2E');
  await page.click('button[type="submit"]:has-text("Save")');

  // Sign out
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');

  // Forgot password
  await page.goto('/forgot-password');
  await page.fill('input[name="email"]', email);
  await page.click('button[type="submit"]');
  await expect(page.locator('text=reset link is on its way')).toBeVisible();

  // Pull token from the DB (Mailpit not available in plain CI).
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.passwordResetToken).toBeTruthy();

    // Re-issue via API so we own the plaintext token.
    const svcMod = await import('../../src/server/services/auth');
    const svc = svcMod.createAuthService({ prisma });
    const token = await svc.createPasswordResetToken(email);
    expect(token).toBeTruthy();

    // Submit new password via the API (server action would also work but this
    // bypasses any redirect/cookie state from the Playwright session).
    const res = await request.post('/api/auth/reset-password', {
      data: { token, newPassword },
    });
    expect(res.status()).toBe(204);
  } finally {
    await prisma.$disconnect();
  }

  // Log in with the new password
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', newPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');
  await expect(page.getByTestId('profile-email')).toHaveText(email);
});
