import { test, expect } from "@playwright/test";
import { workItemsCard, wiCount, resetAndLogin } from "./helpers";

test.describe("smoke", () => {
  test("loads the seeded PAY-412 feature and its work items", async ({ page }) => {
    await resetAndLogin(page);
    await page.goto("/");

    await expect(page.locator(".brand")).toContainText("Cadence");
    await expect(page.locator("h1")).toContainText("Apple Pay at checkout");

    const card = workItemsCard(page);
    await expect(card).toBeVisible();
    await expect(card.locator(".wirow")).toHaveCount(5);
    await expect(wiCount(page)).toHaveText("0/5 done");
  });

  test("header shows the signed-in user and their role", async ({ page }) => {
    await resetAndLogin(page);
    await page.goto("/");
    await expect(page.locator(".who")).toContainText("Maya Chen");
    await expect(page.locator(".who .kpill")).toHaveText("Product");
  });

  test("unauthenticated visit redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await page.waitForURL(/\/login/);
    await expect(page.locator(".login-card h1")).toHaveText("Sign in");
  });

  test("login → app → logout round-trip through the UI", async ({ page }) => {
    await resetAndLogin(page); // ensures seed users exist; then clear to test the form
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByPlaceholder("you@company.dev").fill("maya@cadence.dev");
    await page.getByPlaceholder("••••••••").fill(process.env.SEED_PM_PASSWORD || "maya-dev-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await expect(page.locator(".who")).toContainText("Maya Chen");
    await page.locator('.who button[title="Sign out"]').click();
    await page.waitForURL(/\/login/);
  });
});
