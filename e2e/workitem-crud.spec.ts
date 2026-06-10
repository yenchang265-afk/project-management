import { test, expect } from "@playwright/test";
import { workItemsCard, historyCard, historyCount, wiRow, wiCount, addWorkItem } from "./helpers";

// Every page load reseeds (no persistence), so each test starts from the same fixture:
// PAY-412 selected, 5 work items (PAY-418/419/420/421/423), 0 done.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(wiCount(page)).toHaveText("0/5 done");
});

test.describe("work item CRUD", () => {
  test("create: adds a work item with the next deterministic id", async ({ page }) => {
    await addWorkItem(page, "E2E created item", "bug");

    // next free id after 418..421, 423 (monotonic) is PAY-424
    await expect(wiRow(page, "PAY-424")).toBeVisible();
    await expect(wiRow(page, "PAY-424")).toContainText("E2E created item");
    await expect(wiCount(page)).toHaveText("0/6 done");
    await expect(historyCard(page).getByText("Added work item PAY-424")).toBeVisible();
  });

  test("create: Add is disabled until a non-blank title is entered", async ({ page }) => {
    const card = workItemsCard(page);
    await card.getByRole("button", { name: /add work item/i }).click();
    const submit = card.locator('.wi-addrow button[title="Add"]');

    await expect(submit).toBeDisabled();
    await card.getByPlaceholder(/Work item title/).fill("   "); // whitespace only
    await expect(submit).toBeDisabled();
    await card.getByPlaceholder(/Work item title/).fill("real title");
    await expect(submit).toBeEnabled();
  });

  test("update: edits a title inline and logs the change", async ({ page }) => {
    const row = wiRow(page, "PAY-418");
    await row.locator('button[title="Edit"]').click();
    await row.locator("input.wi-inp").fill("Renamed via e2e");
    await row.locator('button[title="Save"]').click();

    await expect(wiRow(page, "PAY-418").locator(".wit")).toHaveText("Renamed via e2e");
    await expect(historyCard(page).getByText("Updated work item PAY-418")).toBeVisible();
  });

  test("update: walking the WI flow to done updates the done count and progress bar", async ({ page }) => {
    // state select is flow-checked: each step only offers legal moves from the WI workflow table
    const stateSel = () => wiRow(page, "PAY-418").locator('select[title="State"]');
    await stateSel().selectOption({ label: "→ In Progress" });
    await stateSel().selectOption({ label: "→ In Review" });
    await stateSel().selectOption({ label: "→ Done" });

    await expect(wiCount(page)).toHaveText("1/5 done");
    await expect(workItemsCard(page).locator(".wi-prog .lb")).toHaveText("20%");
  });

  test("update: illegal flow move is not offered (todo can only start)", async ({ page }) => {
    const options = wiRow(page, "PAY-418").locator('select[title="State"] option');
    await expect(options).toHaveText(["To Do", "→ In Progress"]);
  });

  test("update: a no-op save appends no event (no-op guard)", async ({ page }) => {
    const before = await historyCount(page).textContent();
    const row = wiRow(page, "PAY-420");
    await row.locator('button[title="Edit"]').click();
    await row.locator('button[title="Save"]').click(); // saved without editing anything
    const after = await historyCount(page).textContent();

    expect(after).toBe(before); // log unchanged — no contentless WI_UPDATE
  });

  test("delete: tombstones a work item and updates the count", async ({ page }) => {
    await expect(wiRow(page, "PAY-421")).toBeVisible();
    await wiRow(page, "PAY-421").locator('button[title="Delete"]').click();

    await expect(wiRow(page, "PAY-421")).toHaveCount(0);
    await expect(wiCount(page)).toHaveText("0/4 done");
    await expect(historyCard(page).getByText("Removed work item PAY-421")).toBeVisible();
  });

  test("both roles can create work items (no role guard)", async ({ page }) => {
    await page.locator('.roleswitch button[data-role="Dev"]').click();
    await addWorkItem(page, "Added as Dev");

    await expect(wiRow(page, "PAY-424")).toContainText("Added as Dev");
    await expect(wiCount(page)).toHaveText("0/6 done");
  });
});
