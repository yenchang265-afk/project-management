import { test, expect, type Page } from "@playwright/test";
import { resetAndLogin } from "./helpers";

/* Cross-item links (ITEM_LINK / ITEM_UNLINK): add an outgoing link from the
   Links card, see the inbound direction on the target item, then unlink. */

const linksCard = (page: Page) => page.locator(".card", { hasText: "Links" }).first();

async function openItem(page: Page, id: string) {
  await page.locator(".nav-item", { hasText: id }).first().click();
  await expect(page.locator("h1")).not.toHaveText("");
}

test.beforeEach(async ({ page }) => { await resetAndLogin(page); await page.goto("/"); });

test.describe("item links", () => {
  test("starts empty, links to another item, and unlinks", async ({ page }) => {
    const card = linksCard(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText("No links yet.");

    await card.getByLabel("Link kind").selectOption("blocks");
    await card.getByLabel("Link target").selectOption("SEARCH-220");
    await card.getByRole("button", { name: "Link", exact: true }).click();

    const row = card.locator(".item-link-row", { hasText: "SEARCH-220" });
    await expect(row).toContainText("blocks");

    await row.getByRole("button", { name: /Unlink SEARCH-220/ }).click();
    await expect(card).toContainText("No links yet.");
  });

  test("target item shows the inbound direction", async ({ page }) => {
    const card = linksCard(page);
    await card.getByLabel("Link kind").selectOption("blocks");
    await card.getByLabel("Link target").selectOption("SEARCH-220");
    await card.getByRole("button", { name: "Link", exact: true }).click();
    await expect(card.locator(".item-link-row", { hasText: "SEARCH-220" })).toBeVisible();

    await openItem(page, "SEARCH-220");
    const targetCard = linksCard(page);
    const inboundRow = targetCard.locator(".item-link-row", { hasText: "PAY-412" });
    await expect(inboundRow).toContainText("blocked by");
    await expect(inboundRow).toContainText("inbound");
  });
});
