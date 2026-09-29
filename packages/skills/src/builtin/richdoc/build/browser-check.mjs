/* global document, innerWidth, getComputedStyle, window */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const skill = resolve(import.meta.dirname, "../../../../dist/builtin/richdoc");
const root = await mkdtemp(join(await realpath(tmpdir()), "richdoc-browser-"));
let browser, server;
try {
  const copied = join(root, "copied skill");
  await cp(skill, copied, { recursive: true });
  const docs = join(root, "docs");
  execFileSync(
    process.execPath,
    [join(copied, "scripts/richdoc.mjs"), "prepare", docs],
    { env: { ...process.env, NERVE_HOME: join(root, "nerve-home") } },
  );
  await cp(join(copied, "examples"), docs, { recursive: true });
  server = createServer((request, response) => {
    void (async () => {
      const path = resolve(
        docs,
        `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`,
      );
      if (!path.startsWith(docs + "/")) {
        response.writeHead(403).end();
        return;
      }
      try {
        const mime = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
          ".ttf": "font/ttf",
        };
        response.setHeader(
          "Content-Type",
          mime[extname(path)] ?? "application/octet-stream",
        );
        response.end(await readFile(path));
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  browser = await chromium.launch({ headless: true });
  for (const transport of ["file", "http"]) {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const unexpected = [],
      errors = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "file:" || url.origin === `http://127.0.0.1:${port}`)
        return route.continue();
      unexpected.push(url.href);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(String(error)));
    for (const name of [
      "research",
      "design",
      "comparison",
      "dashboard",
      "technical-showcase",
    ]) {
      const url =
        transport === "file"
          ? pathToFileURL(join(docs, `${name}.html`)).href
          : `http://127.0.0.1:${port}/${name}.html`;
      await page.goto(url);
      await page.waitForFunction(
        () =>
          [
            ...document.querySelectorAll(
              "rd-code,rd-math,rd-diagram,rd-chart,rd-icon",
            ),
          ].every(
            (n) => n.dataset.state === "ready" || n.dataset.state === "error",
          ),
        { timeout: 60_000 },
      );
      const failures = await page
        .locator('[data-state="error"]')
        .allTextContents();
      assert.deepEqual(failures, [], `${transport}/${name}`);
      assert.equal(await page.locator("h1").count(), 1);
      await page.setViewportSize({ width: 380, height: 800 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
        `${name}: narrow overflow`,
      );
      const columns = page.locator("rd-cols").first();
      if (await columns.count())
        assert.ok(
          !(
            await columns.evaluate(
              (n) => getComputedStyle(n).gridTemplateColumns,
            )
          ).includes(" "),
          `${name}: columns should stack`,
        );
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (name === "technical-showcase") {
        assert.equal(await page.locator("rd-chart:has(svg)").count(), 7);
        assert.equal(await page.locator("rd-chart table").count(), 7);
        assert.equal(await page.locator("rd-math .katex").count(), 2);
        assert.equal(await page.locator("rd-diagram svg").count(), 1);
        assert.equal(await page.locator("rd-icon svg").count(), 1);
        const toc = page.locator("rd-toc a").first();
        await toc.focus();
        await page.keyboard.press("Enter");
        assert.ok(new URL(page.url()).hash);
        await page.locator("[data-rd-controls] summary").click();
        const mode = page.locator("[data-rd-controls] select").nth(1);
        await mode.selectOption("dark");
        assert.equal(
          await page.locator("rd-page").getAttribute("mode"),
          "dark",
        );
        await mode.selectOption("light");
        assert.equal(
          await page.locator("rd-page").getAttribute("mode"),
          "light",
        );
        await page.locator('[aria-label="Copy code"]').first().click();
        await page.waitForFunction(
          () =>
            document.querySelector('[aria-label="Copy code"]').textContent !==
            "Copy",
        );
      }
    }
    await page.evaluate(() => {
      const diagram = document.createElement("rd-diagram");
      diagram.setAttribute("caption", "Rejected external image");
      diagram.textContent =
        'graph TD; A@{ img: "https://unexpected.invalid/image.png" }';
      document.querySelector("rd-page").append(diagram);
    });
    await page.waitForSelector('rd-diagram[data-state="error"]');
    assert.deepEqual(unexpected, [], "Unexpected network egress");
    assert.deepEqual(errors, [], "Browser exceptions");
    await context.close();
  }
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const page = await plain.newPage();
  await page.goto(pathToFileURL(join(docs, "technical-showcase.html")).href);
  assert.match(
    await page.locator("rd-code").first().textContent(),
    /const clamp/,
  );
  assert.match(await page.locator("rd-chart").first().textContent(), /value/);
  await plain.close();
  const restricted = await browser.newContext();
  await restricted.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  const restrictedPage = await restricted.newPage();
  await restrictedPage.goto(pathToFileURL(join(docs, "research.html")).href);
  await restrictedPage.waitForSelector("[data-rd-controls]");
  await restricted.close();
  const failure = await browser.newContext();
  await failure.route("**/vendor/*.js", (route) => route.abort());
  const failurePage = await failure.newPage();
  await failurePage.goto(`http://127.0.0.1:${port}/technical-showcase.html`);
  await failurePage.waitForSelector('rd-code[data-state="error"]');
  assert.match(
    await failurePage.locator("rd-code").first().textContent(),
    /const clamp/,
  );
  await failure.close();
  console.log(
    "Richdoc browser checks passed: file/HTTP, offline rendering, narrow/wide, keyboard/settings, unavailable storage, no-JS and failed renderers.",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
}
