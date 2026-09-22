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

  it("adds disabled image generation defaults to existing tool settings", () => {
    const legacy = structuredClone(defaultSettings) as unknown as {
      tools: Record<string, unknown> & { disabled: string[] };
    };
    delete legacy.tools.imageGeneration;
    legacy.tools.disabled = legacy.tools.disabled.filter(
      (name) => name !== "generate_image",
    );

    const { settings, changed } = normalizeSettings(legacy);

    assert.equal(changed, true);
    assert.equal(settings.tools.disabled.includes("generate_image"), true);
    assert.deepEqual(settings.tools.imageGeneration, {
      provider: "openai-codex",
      model: "gpt-image-2.5-flare",
      options: { quality: "auto", size: "auto", background: "auto" },
    });
  });

  it("migrates prerelease GPT Image settings and preserves enablement", () => {
    for (const disabled of [false, true]) {
      const legacy = structuredClone(defaultSettings) as unknown as {
        tools: Record<string, unknown> & { disabled: string[] };
      };
      legacy.tools.imageGeneration = {
        model: "gpt-image-2.5-sunburst",
        quality: "high",
        size: "1024x1024",
        background: "transparent",
      };
      legacy.tools.disabled = disabled ? ["gpt_image"] : [];

      const { settings, changed } = normalizeSettings(legacy);

      assert.equal(changed, true);
      assert.equal(
        settings.tools.disabled.includes("generate_image"),
        disabled,
      );
      assert.equal(
        settings.tools.disabled.includes("gpt_image" as never),
        false,
      );
      assert.deepEqual(settings.tools.imageGeneration, {
        provider: "openai-codex",
        model: "gpt-image-2.5-sunburst",
        options: {
          quality: "high",
          size: "1024x1024",
          background: "transparent",
        },
      });
      assert.equal(normalizeSettings(settings).changed, false);
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
