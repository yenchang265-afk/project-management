import { expect, type Page, type Locator } from "@playwright/test";

/* Phase 1: state lives in MariaDB. Every test re-seeds via the e2e-only reset
   endpoint (E2E_TEST=1) and signs in as the seed PM through the API (the
   request context shares the browser's cookie jar). */
export async function resetAndLogin(page: Page): Promise<void> {
  // retry: the very first call can race the dev server's route compilation
  let reset = await page.request.post("/api/test/reset");
  for (let i = 0; !reset.ok() && i < 3; i++) {
    await page.waitForTimeout(1000);
    reset = await page.request.post("/api/test/reset");
  }
  expect(reset.ok(), "reset endpoint must be enabled (E2E_TEST=1)").toBeTruthy();
  const login = await page.request.post("/api/auth/login", {
    data: { email: "maya@cadence.dev", password: process.env.SEED_PM_PASSWORD || "maya-dev-password" },
  });
  expect(login.ok(), "seed PM login must succeed (run npm run db:seed)").toBeTruthy();
  // warm up the lazily-compiled API routes (Next dev compiles per-route on first
  // hit; on slow filesystems that blows assertion timeouts mid-test)
  await page.request.post("/api/items/__warmup__/commands", { data: {} });
  await page.request.get("/api/items");
}

/* Shared locators for the Cadence UI. Selectors lean on existing accessible hooks
   (title attributes, placeholders, visible text) so the components need no test ids. */

export function workItemsCard(page: Page): Locator {
  return page.locator(".card", { hasText: "Work items" });
}

export function historyCard(page: Page): Locator {
  return page.locator(".card", { hasText: "History" });
}

/** A work-item row, located by its id text (e.g. "PAY-418"). */
export function wiRow(page: Page, id: string): Locator {
  return workItemsCard(page).locator(".wirow", { hasText: id });
}

/** The "{done}/{total} done" counter in the Work items card header. */
export function wiCount(page: Page): Locator {
  return workItemsCard(page).locator(".card-h .mono");
}

/** The History card's "{n} events · append-only" counter. */
export function historyCount(page: Page): Locator {
  return historyCard(page).locator(".card-h .mono");
}

/** Open the inline add form and create a work item. */
export async function addWorkItem(page: Page, title: string, type?: "story" | "task" | "bug"): Promise<void> {
  const card = workItemsCard(page);
  await card.getByRole("button", { name: /add work item/i }).click();
  if (type) await card.locator('.wi-addrow select[title="Type"]').selectOption(type);
  await card.getByPlaceholder(/Work item title/).fill(title);
  await card.locator('.wi-addrow button[title="Add"]').click();
}
