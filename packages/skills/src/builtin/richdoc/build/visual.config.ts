import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: resolve(import.meta.dirname, "../test"),
  testMatch: "visual.spec.ts",
  snapshotPathTemplate: "{testDir}/visual/{arg}{ext}",
  outputDir: resolve(
    import.meta.dirname,
    "../../../../../../test-results/richdoc-visual",
  ),
  workers: 1,
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 1200 },
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.015 },
  },
});
