import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Nerve is a dense desktop app, so every interactive control shares one compact
 * height scale instead of each component inventing its own. Consumers are
 * expected to pick a size, never to patch a height through `class`. */
const controlScale = ["h-6", "h-7", "h-8", "h-9"] as const;
const iconScale = ["size-6", "size-7", "size-8", "size-9"] as const;

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function heightClasses(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])h-(\d+(?:\.\d+)?)/g)].map(
    (match) => `h-${match[1]}`,
  );
}

const sizedControls = [
  ["button", "./button/button.svelte"],
  ["toggle", "./toggle/toggle.svelte"],
  ["input", "./input/input.svelte"],
  ["select-trigger", "./select/select-trigger.svelte"],
  ["tabs-list", "./tabs/tabs-list.svelte"],
] as const;

describe("control scale", () => {
  it("keeps every sized control on the shared compact height scale", () => {
    for (const [name, path] of sizedControls) {
      for (const height of heightClasses(source(path))) {
        // h-5 and below are label/micro rows (badges, file chips), not controls.
        if (Number(height.slice(2)) <= 5) continue;
        assert.ok(
          (controlScale as readonly string[]).includes(height),
          `${name} uses ${height}, which is outside the shared control scale ${controlScale.join("/")}`,
        );
      }
    }
  });

  it("keeps button and toggle size variants aligned", () => {
    const extract = (text: string, variant: string) => {
      const match = text.match(
        new RegExp(`\\b${variant}:\\s*\\n?\\s*"([^"]*)"`, "m"),
      );
      assert.ok(match, `missing ${variant} size variant`);
      return heightClasses(match[1])[0];
    };
    const button = source("./button/button.svelte");
    const toggle = source("./toggle/toggle.svelte");

    for (const variant of ["xs", "sm", "lg"] as const) {
      assert.equal(
        extract(toggle, variant),
        extract(button, variant),
        `toggle ${variant} height must match button ${variant}`,
      );
    }
  });

  it("keeps square icon buttons on the same scale as their text sizes", () => {
    const button = source("./button/button.svelte");
    const sizes = [...button.matchAll(/(?<![\w-])size-(\d+)/g)].map(
      (match) => `size-${match[1]}`,
    );
    const iconSizes = sizes.filter((size) => Number(size.slice(5)) >= 6);
    assert.ok(iconSizes.length > 0, "expected icon button sizes");
    for (const size of iconSizes) {
      assert.ok(
        (iconScale as readonly string[]).includes(size),
        `icon button uses ${size}, which is outside the shared scale ${iconScale.join("/")}`,
      );
    }
  });
});
