import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Project Management/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Project Management");
});
