import { expect, test } from '@playwright/test';

test('GET /api/health returns ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  await expect(res.json()).resolves.toEqual({ status: 'ok' });
});
