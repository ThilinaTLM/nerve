import { expect, test } from "@playwright/test";

const token = "nt_browser_test_token";

test("local UI is authenticated by the seeded session cookie", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/nerve/i);
  await expect(page.locator("body")).not.toBeEmpty();

  const config = await page.request.get("/api/client-config");
  expect(config.ok()).toBe(true);
  await expect(config.json()).resolves.toMatchObject({
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
    wsUrl: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:/),
  });
  expect(pageErrors).toEqual([]);
});

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("static responses do not hand out the cookie", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBe(true);
    expect(await page.context().cookies()).toEqual([]);
    const config = await page.request.get("/api/client-config");
    expect(config.status()).toBe(401);
  });

  test("?token= is exchanged for a Strict HttpOnly cookie and stripped", async ({
    page,
  }) => {
    await page.goto(`/?token=${token}`);
    await expect(page).toHaveTitle(/nerve/i);
    expect(new URL(page.url()).search).toBe("");

    const authCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "nerve_token",
    );
    expect(authCookie?.httpOnly).toBe(true);
    expect(authCookie?.sameSite).toBe("Strict");
    expect((await page.request.get("/api/client-config")).status()).toBe(200);

    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await page.request.get("/api/client-config")).status()).toBe(200);
  });
});
