import { expect, test, type Page } from "@playwright/test";

const primaryTabs = (page: Page) =>
  page.getByRole("navigation", { name: "Primary" });

test.describe("phone shell", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("routes through tabs and a pushed screen with system back", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto("/");

    const tabs = primaryTabs(page);
    await expect(tabs.getByRole("button")).toHaveCount(3);
    await expect(tabs.getByRole("button", { name: /^Inbox/ })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "Projects" })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "Activity" })).toBeVisible();

    // Each root keeps its own screen.
    await tabs.getByRole("button", { name: "Activity" }).click();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

    // Settings is a pushed screen: the tab bar yields the viewport to it.
    await page.getByRole("button", { name: "Settings" }).first().click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(tabs).toHaveCount(0);

    // The system back gesture pops the route back to the tab root.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(primaryTabs(page)).toBeVisible();

    // The in-app back button pops too.
    await page.getByRole("button", { name: "Settings" }).first().click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

    // Other tabs keep their own, independent stack.
    await primaryTabs(page).getByRole("button", { name: "Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("restores the route stack after a reload and back still pops it", async ({
    page,
  }) => {
    await page.goto("/");
    await primaryTabs(page).getByRole("button", { name: "Activity" }).click();
    await page.getByRole("button", { name: "Settings" }).first().click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(primaryTabs(page)).toHaveCount(0);

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(primaryTabs(page)).toBeVisible();
  });
});

test("desktop viewport keeps the dock workbench", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page).toHaveTitle(/nerve/i);
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(primaryTabs(page)).toHaveCount(0);
});
