/**
 * Regenerates the 1280x640 Open Graph image from the real homepage hero, so the
 * social card cannot drift away from the headline the page actually ships.
 *
 * Usage: build the site, serve it, then point this at the preview URL:
 *
 *   pnpm --filter @nervekit/website build
 *   pnpm --filter @nervekit/website preview &
 *   node scripts/screenshots/social-preview.mjs --base-url=http://127.0.0.1:4321
 */

import { parseArgs } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://127.0.0.1:4321" },
    out: { type: "string", default: "src/assets/social-preview.png" },
    theme: { type: "string", default: "dark" },
  },
});

const browser = await chromium.launch();
const context = await browser.newContext({
  /* Captured wider than the card and downscaled: at 1280 wide the hero
   * headline wraps to four lines and pushes the lede out of frame. */
  viewport: { width: 1600, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: values.theme === "light" ? "light" : "dark",
  reducedMotion: "reduce",
});
await context.addInitScript(
  `try { localStorage.setItem("nerve-theme", ${JSON.stringify(values.theme)}); } catch {}`,
);
const page = await context.newPage();
await page.goto(values["base-url"], { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.mouse.move(-50, -50);
const buffer = await page.screenshot();
await browser.close();

/* The OG image is served at 1280x640; capturing larger at DPR 2 keeps the text
 * crisp through the downscale. */
await sharp(buffer).resize(1280, 640).png().toFile(values.out);
console.log(`wrote ${values.out}`);
