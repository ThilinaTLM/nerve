/**
 * Captures the published workbench screenshots from a seeded demo daemon.
 *
 * Expects a daemon already running against a throwaway NERVE_HOME (see
 * `run.mjs`). Writes raw PNG frames plus a text snapshot per frame into
 * `.screenshots/`, which `check-captures.mjs` scans before anything is copied
 * into `src/assets`.
 *
 * Determinism is deliberate: reduced motion, a fixed timezone and locale, a
 * frozen clock, and the pointer parked off-canvas. Two captures of the same
 * scene should differ only by colour mode.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { installDemoUsage } from "./demo-usage.mjs";
import {
  DESKTOP_SCALE,
  DESKTOP_SCENES,
  DESKTOP_VIEWPORT,
  MOBILE_SCALE,
  MOBILE_SCENES,
  MOBILE_VIEWPORT,
} from "./scenes.mjs";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://127.0.0.1:3847" },
    out: { type: "string", default: ".screenshots" },
    scenes: { type: "string" },
    kind: { type: "string", default: "both" },
    theme: { type: "string", default: "both" },
  },
});

const baseUrl = values["base-url"];
const outDir = values.out;
const wanted = values.scenes
  ? new Set(values.scenes.split(",").map((value) => value.trim()))
  : undefined;
const themes = values.theme === "both" ? ["light", "dark"] : [values.theme];

/** Capture themes. `nerve-theme` is the only theme key; the legacy
 * light/dark/mode-watcher keys are migrated and removed by the app. */
const SCENE_THEMES = { light: "nerve-light", dark: "nerve-dark" };

/** Discover must not auto-open over a scene; a dedicated scene opens it. */
const DISCOVER_STATE = {
  schemaVersion: 1,
  seen: {},
  autoOpen: { enabled: false, count: 0 },
};

/** Applied before the app boots so the first paint is already correct. */
function themeBootstrap(mode, theme = SCENE_THEMES[mode]) {
  return `
    try {
      localStorage.setItem("nerve-theme", ${JSON.stringify(theme)});
      localStorage.setItem("nerve.discover.state", ${JSON.stringify(JSON.stringify(DISCOVER_STATE))});
      document.documentElement.classList.toggle("dark", ${mode === "dark"});
      document.documentElement.style.colorScheme = ${JSON.stringify(mode)};
    } catch {}
  `;
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  /* Skeletons and streaming placeholders must be gone: a screenshot of a
   * loading state is worse than a stale screenshot. */
  await page
    .waitForFunction(
      "document.querySelectorAll('[data-skeleton], .skeleton').length === 0",
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(800);
}

async function openWorkbench(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await settle(page);
  /* Park the pointer outside the viewport so no hover state is captured. */
  await page.mouse.move(-50, -50);
}

async function captureGroup({ browser, scenes, viewport, scale, kind }) {
  const results = [];
  for (const mode of themes) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      isMobile: kind === "mobile",
      hasTouch: kind === "mobile",
      reducedMotion: "reduce",
      colorScheme: mode,
      timezoneId: "Europe/London",
      locale: "en-GB",
    });
    await installDemoUsage(context);
    await context.addInitScript(themeBootstrap(mode));
    const page = await context.newPage();

    for (const scene of scenes) {
      if (wanted && !wanted.has(scene.id)) continue;
      await openWorkbench(page);
      try {
        await scene.drive(page);
      } catch (error) {
        await mkdir(join(outDir, kind), { recursive: true });
        await writeFile(
          join(outDir, kind, `${scene.id}-${mode}-failed.txt`),
          await page.locator("body").ariaSnapshot(),
          "utf8",
        );
        throw new Error(
          `Scene ${kind}/${scene.id} (${mode}) failed to reach its state`,
          { cause: error },
        );
      }
      await settle(page);
      // Desktop always has a quota chip; mobile detail screens may hide it.
      if (kind === "desktop") {
        await page
          .getByRole("button", {
            name: "Open subscription usage details",
            exact: true,
          })
          .getByText("46%", { exact: true })
          .waitFor();
      }
      await page.mouse.move(-50, -50);

      const name = `${kind}/${scene.id}-${mode}`;
      const file = join(outDir, `${name}.png`);
      await mkdir(join(outDir, kind), { recursive: true });
      await page.screenshot({ path: file });
      await writeFile(
        join(outDir, `${name}.txt`),
        await page.locator("body").innerText(),
        "utf8",
      );
      console.log(`shot  ${name}`);
      /* Tabs opened by one scene must not leak into the next frame. */
      for (const tab of ["Discover", "Settings"]) {
        const close = page.getByRole("button", {
          name: `Close ${tab}`,
          exact: true,
        });
        if (await close.count())
          await close
            .first()
            .click()
            .catch(() => {});
      }
      results.push(name);
    }

    await context.close();
  }
  return results;
}

const browser = await chromium.launch();
try {
  if (values.kind !== "mobile")
    await captureGroup({
      browser,
      scenes: DESKTOP_SCENES,
      viewport: DESKTOP_VIEWPORT,
      scale: DESKTOP_SCALE,
      kind: "desktop",
    });
  if (values.kind !== "desktop")
    await captureGroup({
      browser,
      scenes: MOBILE_SCENES,
      viewport: MOBILE_VIEWPORT,
      scale: MOBILE_SCALE,
      kind: "mobile",
    });
} finally {
  await browser.close();
}
