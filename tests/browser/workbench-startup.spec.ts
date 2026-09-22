import { expect, test } from "@playwright/test";

test("local UI bootstraps an authenticated browser session", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/nerve/i);
  await expect(page.locator("body")).not.toBeEmpty();

  const cookies = await page.context().cookies();
  const authCookie = cookies.find((cookie) => cookie.name === "nerve_token");
  expect(authCookie).toBeDefined();
  expect(authCookie?.httpOnly).toBe(true);
  expect(authCookie?.sameSite).toBe("Strict");

  const config = await page.request.get("/api/client-config");
  expect(config.ok()).toBe(true);
  await expect(config.json()).resolves.toMatchObject({
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
    wsUrl: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:/),
  });
  expect(pageErrors).toEqual([]);
});

test("reload preserves local authentication and renders the workbench", async ({
  page,
}) => {
  await page.goto("/");
  const initialCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "nerve_token",
  );
  expect(initialCookie).toBeDefined();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/nerve/i);
  const config = await page.request.get("/api/client-config");
  expect(config.status()).toBe(200);
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "nerve_token",
    )?.value,
  ).toBe(initialCookie?.value);
});
