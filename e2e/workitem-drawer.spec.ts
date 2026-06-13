import { test, expect, type Page } from "@playwright/test";
import { wiRow, historyCard, resetAndLogin, openSeedItem } from "./helpers";

test.beforeEach(async ({ page }) => { await resetAndLogin(page); await page.goto("/"); await openSeedItem(page); });

async function openDrawer(page: Page, id: string) {
  await wiRow(page, id).locator('button.wi-act[title="Open details"]').click();
  await expect(page.locator(".wi-drawer")).toBeVisible();
}

const field = (page: Page, label: string) =>
  page.locator(".wi-drawer .wi-field", { hasText: label });

test.describe("work item detail drawer", () => {
  test("opens and closes", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    await expect(page.locator(".wi-drawer")).toContainText("PAY-418");
    await page.locator('.wi-drawer button[title="Close"]').click();
    await expect(page.locator(".wi-drawer")).toHaveCount(0);
  });

  test("closes on Escape", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    await page.keyboard.press("Escape");
    await expect(page.locator(".wi-drawer")).toHaveCount(0);
  });

  test("edits description and persists it to the log (commit on blur)", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    const desc = field(page, "Description").locator("textarea");
    await desc.fill("Render the Apple Pay sheet on tap");
    await desc.press("Tab"); // blur -> commit
    await expect(historyCard(page).getByText("Updated work item PAY-418")).toBeVisible();
    await expect(desc).toHaveValue("Render the Apple Pay sheet on tap");
  });

  test("sets priority and story points", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    await field(page, "Priority").locator("select").selectOption("2");
    const pts = field(page, "Story points").locator("input");
    await pts.fill("5");
    await pts.press("Tab");
    await expect(field(page, "Priority").locator("select")).toHaveValue("2");
    await expect(pts).toHaveValue("5");
    // two separate WI_UPDATE entries: one for priority, one for storyPoints
    await expect(historyCard(page).getByText(/Updated work item PAY-418/)).toHaveCount(2);
  });

  test("clears a set priority via the — option", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    const sel = field(page, "Priority").locator("select");
    await sel.selectOption("2");
    await expect(sel).toHaveValue("2");
    await sel.selectOption(""); // the "—" option -> clears back to unset
    await expect(sel).toHaveValue("");
  });

  test("focuses the title on open (dialog focus management)", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    await expect(page.locator(".wi-drawer-title")).toBeFocused();
  });

  test("adds and removes a tag", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    const tagInput = page.locator(".wi-drawer .wi-tag-input");
    await tagInput.fill("payments");
    await tagInput.press("Enter");
    const chip = page.locator(".wi-drawer .wi-tag", { hasText: "payments" });
    await expect(chip).toBeVisible();
    await chip.locator("button").click();
    await expect(page.locator(".wi-drawer .wi-tag", { hasText: "payments" })).toHaveCount(0);
  });

  test("posts a comment to the discussion thread", async ({ page }) => {
    await openDrawer(page, "PAY-418");
    await page.locator(".wi-comment-add textarea").fill("Needs design review first");
    await page.locator(".wi-comment-add button", { hasText: "Post" }).click();
    await expect(page.locator(".wi-comments")).toContainText("Needs design review first");
    await expect(historyCard(page).getByText("Commented on PAY-418")).toBeVisible();
  });
});
