// E2E for Phase 5a — Admin Audit Log surface.
//
// Flow:
//   1. Register user A and bump to ADMIN in OrgMembership (direct DB).
//   2. Sign in via /login.
//   3. Trigger a second registration via the API (creates an audit row).
//   4. Navigate to /admin/audit and confirm the auth.register row is shown.
//   5. Verify the CSV download button works and the content has our row.

import { test, expect } from '@playwright/test';

const hasDb = !!process.env.DATABASE_URL;
test.skip(!hasDb, 'requires DATABASE_URL (CI workflow brings up Postgres)');

test('ADMIN can view /admin/audit and download CSV', async ({ page, request }) => {
  const ts = Date.now();
  const adminEmail = `audit-admin-${ts}@example.com`;
  const targetEmail = `audit-target-${ts}@example.com`;
  const password = 'pwd-abcd-1234';

  // --- register admin via UI ---
  await page.goto('/register');
  await page.fill('input[name="name"]', 'Audit Admin');
  await page.fill('input[name="email"]', adminEmail);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile');

  // --- bump to ADMIN role + clear stale audit rows so our assertions are crisp ---
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) throw new Error('admin missing');
    await prisma.orgMembership.upsert({
      where: { userId: admin.id },
      update: { role: 'ADMIN' },
      create: { userId: admin.id, role: 'ADMIN' },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Force a fresh session so the new ADMIN role is reflected in the JWT.
  await page.goto('/login');
  await page.fill('input[name="email"]', adminEmail);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  // --- trigger an auditable action: register another user via the API ---
  const regRes = await request.post('/api/auth/register', {
    data: { email: targetEmail, password, name: 'Audit Target' },
  });
  expect(regRes.status()).toBeLessThan(400);

  // --- navigate to /admin/audit and assert the row appears ---
  await page.goto('/admin/audit');
  await expect(page.getByTestId('audit-table')).toBeVisible();

  // Poll: subscribers are fire-and-forget; the row may take a moment.
  let found = false;
  for (let i = 0; i < 10 && !found; i++) {
    await page.reload();
    const txt = await page.getByTestId('audit-table').textContent();
    if (txt?.includes('auth.register') && txt.includes(targetEmail)) {
      found = true;
      break;
    }
    await page.waitForTimeout(200);
  }
  expect(found).toBe(true);

  // --- CSV download: trigger and assert the content ---
  const csvRes = await page.request.get('/api/admin/audit/export.csv');
  expect(csvRes.status()).toBe(200);
  expect(csvRes.headers()['content-type']).toMatch(/text\/csv/);
  const body = await csvRes.text();
  expect(body.split('\n')[0]).toBe('id,at,kind,actorId,actorEmail,target,payload');
  expect(body).toContain('auth.register');
  expect(body).toContain(targetEmail);
});
