import { type Page, type Locator } from "@playwright/test";

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
