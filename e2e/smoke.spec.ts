import { test, expect } from "@playwright/test";
import { workItemsCard, wiCount } from "./helpers";

test.describe("smoke", () => {
  test("loads the seeded PAY-412 feature and its work items", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".brand")).toContainText("Cadence");
    await expect(page.locator("h1")).toContainText("Apple Pay at checkout");

    const card = workItemsCard(page);
    await expect(card).toBeVisible();
    await expect(card.locator(".wirow")).toHaveCount(5);
    await expect(wiCount(page)).toHaveText("0/5 done");
  });

  test("role switch is reflected in the header", async ({ page }) => {
    await page.goto("/");
    await page.locator('.roleswitch button[data-role="Dev"]').click();
    await expect(page.locator('.roleswitch button[data-role="Dev"]')).toHaveAttribute("data-on", "true");
    await expect(page.locator(".who")).toContainText("Sam Okafor");
  });
});
