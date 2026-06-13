import { test, expect } from "@playwright/test";
import { workItemsCard, wiCount, resetAndLogin, openSeedItem, gotoBacklog, gotoOrg } from "./helpers";

test.describe("smoke", () => {
  test("loads the seeded PAY-412 feature and its work items", async ({ page }) => {
    await resetAndLogin(page);
    await page.goto("/");

    await expect(page.locator(".brand")).toContainText("Cadence");
    await openSeedItem(page); // Dashboard → Projects/Backlog → PAY-412 Details
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

  test("backlog groups items by project; team space shows the scrum template", async ({ page }) => {
    await resetAndLogin(page);
    await page.goto("/");

    // Backlog view: PAY-412 lives under Commerce Platform
    await gotoBacklog(page);
    await expect(page.locator(".nav-section").first()).toHaveText("Projects");
    await expect(page.locator(".nav-glabel", { hasText: "Commerce Platform" })).toBeVisible();

    // team space: scrum template with sprint board + backlog (Organization workspace)
    await gotoOrg(page);
    await page.locator(".nav-teamrow", { hasText: "Checkout Crew" }).click();
    await expect(page.locator(".teamspace h1")).toHaveText("Checkout Crew");
    await expect(page.locator(".ts-proj", { hasText: "Commerce Platform" })).toBeVisible();
    await expect(page.locator(".ts-member")).toHaveCount(2); // Maya + Sam
    await expect(page.locator(".ts-sprintbar select")).toHaveValue("Sprint 24");
    await expect(page.locator(".ts-board .board-card").first()).toBeVisible();
    await expect(page.locator(".card-h h3", { hasText: "Backlog" })).toBeVisible();
  });

  test("PM admin: create a team, add a member and a project, from the UI", async ({ page }) => {
    await resetAndLogin(page);
    await page.goto("/");

    // create team via the topbar "＋ New" menu → Team modal
    await page.locator(".newmenu-btn").click();
    await page.getByRole("menuitem", { name: /team/i }).click();
    await page.locator(".admin-modal input").fill("Tiger Team");
    await page.locator(".admin-modal").getByRole("button", { name: "Create" }).click();

    // the new team shows in the Organization workspace sidebar
    await gotoOrg(page);
    await expect(page.locator(".nav-teamrow", { hasText: "Tiger Team" })).toBeVisible();

    // open its team space; add a member and a project
    await page.locator(".nav-teamrow", { hasText: "Tiger Team" }).click();
    await expect(page.locator(".teamspace h1")).toHaveText("Tiger Team");
    await page.locator('select[title="Add member"]').selectOption({ label: "Priya Patel · Dev" });
    await expect(page.locator(".ts-member", { hasText: "Priya Patel" })).toBeVisible();
    await page.locator('select[title="Add project"]').selectOption({ label: "ONB · Onboarding Experience" });
    await expect(page.locator(".ts-proj", { hasText: "Onboarding Experience" })).toBeVisible();

    // remove the member again
    await page.locator('.ts-member button[title="Remove Priya Patel"]').click();
    await expect(page.locator(".ts-member", { hasText: "Priya Patel" })).toHaveCount(0);
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
