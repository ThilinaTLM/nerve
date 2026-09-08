import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import { normalizeSettings } from "../../../src/infrastructure/migrations/post-0012-settings-normalization.js";

describe("settings normalization", () => {
  it("moves retired color themes to their successor instead of resetting", () => {
    for (const [retired, successor] of [
      ["ocean", "solar"],
      ["forest", "rose"],
    ]) {
      const { settings, changed } = normalizeSettings({
        ...defaultSettings,
        ui: { theme: retired, colorMode: "dark" },
      });
      assert.equal(settings.ui.theme, successor);
      assert.equal(settings.ui.colorMode, "dark");
      assert.equal(changed, true);
    }
  });

  it("leaves a supported theme untouched", () => {
    const { settings } = normalizeSettings({
      ...defaultSettings,
      ui: { theme: "midnight", colorMode: "light" },
    });
    assert.equal(settings.ui.theme, "midnight");
  });
});
