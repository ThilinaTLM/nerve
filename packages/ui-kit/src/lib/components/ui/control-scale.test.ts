import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Nerve is a dense desktop app, so every interactive control shares two
 * heights, defined once as theme tokens (`--spacing-control` /
 * `--spacing-control-sm`) that coarse pointers raise. Primitives use the
 * token utilities and consumers never patch a height through `class`. */

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

/** Numeric h-/size-/min-h- utilities at control scale (>= 6 = 24px). */
function numericControlHeights(text: string): string[] {
  return [
    ...text.matchAll(/(?<![\w-])((?:min-h|h|size)-(\d+(?:\.\d+)?))(?![\w.-])/g),
  ]
    .filter((match) => Number(match[2]) >= 6)
    .map((match) => match[1]);
}

function variantBlock(text: string, name: string): string {
  const start = text.indexOf(`${name}: {`);
  assert.ok(start >= 0, `missing ${name} variants`);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name} variants`);
}

function variantKeys(block: string): string[] {
  return [...block.matchAll(/^\s{6}"?([\w-]+)"?:/gm)].map((match) => match[1]);
}

const theme = source("../../../styles/theme.css");
const button = source("./button/button.svelte");
const toggle = source("./toggle-group/toggle-group.svelte");

describe("control scale", () => {
  it("defines the control heights once as non-inline theme tokens with a coarse override", () => {
    assert.match(theme, /@theme \{[^}]*--spacing-control: 1\.75rem;/);
    assert.match(theme, /@theme \{[^}]*--spacing-control-sm: 1\.5rem;/);
    assert.match(
      theme,
      /@media \(pointer: coarse\) \{\s*:root \{[^}]*--spacing-control: [^;]+;[^}]*--spacing-control-sm: [^;]+;/,
    );
  });

  it("limits button sizes to the two text and two icon steps", () => {
    assert.deepEqual(variantKeys(variantBlock(button, "size")), [
      "default",
      "sm",
      "icon",
      "icon-sm",
    ]);
    const size = variantBlock(button, "size");
    assert.match(size, /default:\s*"h-control /);
    assert.match(size, /sm: "h-control-sm /);
    assert.match(size, /icon: "size-control /);
    assert.match(size, /"icon-sm":\s*"size-control-sm /);
  });

  it("keeps toggle sizes aligned with the button text sizes", () => {
    assert.deepEqual(variantKeys(variantBlock(toggle, "size")), [
      "default",
      "sm",
    ]);
    assert.deepEqual(variantKeys(variantBlock(toggle, "variant")), [
      "outline",
      "chip",
    ]);
    assert.match(toggle, /default:\s*"h-control min-w-control /);
    assert.match(toggle, /sm: "h-control-sm min-w-control-sm /);
  });

  it("sizes single-height fields from the control token without a size prop", () => {
    for (const path of [
      "./input/input.svelte",
      "./select/select-trigger.svelte",
    ]) {
      const text = source(path);
      assert.match(text, /(?<![\w-])h-control(?![\w-])/, `${path} height`);
      assert.doesNotMatch(text, /\bsize\b\s*[=?:]/, `${path} has a size prop`);
    }
    assert.match(
      source("./textarea/textarea.svelte"),
      /(?<![\w-])min-h-control(?![\w-])/,
    );
  });

  it("keeps fixed-size controls free of size props", () => {
    for (const path of [
      "./switch/switch.svelte",
      "./checkbox/checkbox.svelte",
      "./radio-group/radio-group-item.svelte",
      "../composites/search-input/search-input.svelte",
      "../composites/icon-action/icon-action.svelte",
      "../composites/select-field/select-field.svelte",
    ]) {
      assert.doesNotMatch(
        source(path),
        /\bsize\?:|\bsize = |data-size/,
        `${path} still exposes a size`,
      );
    }
  });

  it("does not hard-code numeric control heights in the sized primitives", () => {
    for (const path of [
      "./button/button.svelte",
      "./toggle-group/toggle-group.svelte",
      "./input/input.svelte",
      "./textarea/textarea.svelte",
      "./select/select-trigger.svelte",
    ]) {
      const heights = numericControlHeights(source(path));
      assert.deepEqual(heights, [], `${path} hard-codes ${heights.join(", ")}`);
    }
  });

  it("keeps select popover rows as compact as the trigger they open from", () => {
    /* A 28px trigger opening 32px rows made settings dropdowns look bolder than
     * the page around them. */
    const item = source("./select/select-item.svelte");
    assert.match(
      item,
      /(?<![\w-])py-1(?![\w.])/,
      "select item should use py-1 so its row height matches the trigger",
    );
    assert.doesNotMatch(
      item,
      /(?<![\w-])py-(1\.5|2|2\.5|3)(?![\w.])/,
      "select item drifted off the compact scale",
    );
  });
});
