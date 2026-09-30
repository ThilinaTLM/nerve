import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const skill = resolve(import.meta.dirname, "../../../../dist/builtin/richdoc");
let root: string;
test.beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), "richdoc-visual-"));
  execFileSync(
    process.execPath,
    [join(skill, "scripts/richdoc.mjs"), "prepare", root],
    { env: { ...process.env, NERVE_HOME: join(root, "nerve-home") } },
  );
  await cp(
    resolve(import.meta.dirname, "fixtures/visual.html"),
    join(root, "index.html"),
  );
  const source = await readFile(join(root, "index.html"), "utf8");
  await writeFile(
    join(root, "reader.html"),
    source.replace('<rd-page prefs="off">', "<rd-page>"),
  );
  await writeFile(
    join(root, "no-js.html"),
    source.replace(
      '<rd-page prefs="off">',
      '<rd-page prefs="off" theme="graphite-modern" mode="dark">',
    ),
  );
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

for (const theme of ["editorial-warm", "graphite-modern"])
  for (const mode of ["light", "dark"])
    for (const width of [1440, 380]) {
      test(`${theme} ${mode} ${width}`, async ({ page }) => {
        const egress: string[] = [];
        await page.route("**/*", (route) => {
          if (new URL(route.request().url()).protocol === "file:")
            return route.continue();
          egress.push(route.request().url());
          return route.abort();
        });
        await page.setViewportSize({ width, height: 1100 });
        await page.goto(pathToFileURL(join(root, "index.html")).href);
        await page.locator("rd-page").evaluate(
          (node, preferences) => {
            node.setAttribute("theme", preferences.theme);
            node.setAttribute("mode", preferences.mode);
          },
          { theme, mode },
        );
        const families =
          theme === "editorial-warm"
            ? ["Fraunces", "Geist", "Fira Code"]
            : ["Space Grotesk", "Inter", "JetBrains Mono"];
        const fonts = await page.evaluate(async (families) => {
          const loaded = await Promise.all(
            families.map((family) =>
              document.fonts.load(`400 16px "${family}"`, "Richdoc review"),
            ),
          );
          await document.fonts.ready;
          return loaded.map(
            (faces) =>
              faces.length > 0 &&
              faces.every((face) => face.status === "loaded"),
          );
        }, families);
        expect(fonts).toEqual([true, true, true]);
        const canvas = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
          border: getComputedStyle(document.querySelector("rd-page")!)
            .borderWidth,
          font: getComputedStyle(document.querySelector("h1")!).fontFamily,
          bodyFont: getComputedStyle(document.body).fontFamily,
        }));
        expect(canvas.body).toEqual(canvas.root);
        expect(canvas.border).toEqual("0px");
        expect(canvas.font).toContain(families[0]);
        expect(canvas.bodyFont).toContain(families[1]);
        expect(egress).toEqual([]);
        await expect(page).toHaveScreenshot(`${theme}-${mode}-${width}.png`, {
          fullPage: true,
        });
      });
    }

test("reader settings preserve standard width and recover from malformed saved state", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(`richdoc:${location.pathname}`, "null"),
  );
  await page.goto(pathToFileURL(join(root, "reader.html")).href);
  await expect(page.locator("rd-page")).toHaveAttribute("width", "standard");
  const toggle = page.locator("[data-rd-controls] summary");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Width", exact: true }),
  ).toHaveValue("standard");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-rd-controls]")).not.toHaveAttribute("open");
  await expect(toggle).toBeFocused();
});

test("system mode updates the whole canvas and no-JS pages retain the selected palette", async ({
  page,
  browser,
}) => {
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await page
    .locator("rd-page")
    .evaluate((node) => node.setAttribute("mode", "auto"));
  const light = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(dark).not.toEqual(light);
  await page
    .locator("rd-page")
    .evaluate((node) => node.setAttribute("mode", "light"));
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toEqual(light);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const plain = await context.newPage();
    await plain.goto(pathToFileURL(join(root, "no-js.html")).href);
    expect(
      await plain.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toEqual("rgb(15, 17, 21)");
    await expect(plain.locator("h1")).toBeVisible();
    await expect(plain.locator('rd-callout[type="tldr"]')).toContainText(
      "semantic HTML",
    );
  } finally {
    await context.close();
  }
});
