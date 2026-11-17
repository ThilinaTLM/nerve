import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { themeTokenNames } from "../../packages/contracts/src/domains/extensions/theme-file.ts";
import { repoRoot } from "../workspace/repo.ts";
import { withoutThemeBlocks } from "./build-extension-frame-css.ts";

const styles = join(repoRoot, "packages", "ui-kit", "src", "styles");
const read = (file: string) => readFileSync(join(styles, file), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* What a frame gets: theme.css without the per-theme blocks, base/animation/components CSS, and
 * the 17 input tokens that `init.tokensCss` declares. */
const frameCss = strip(
  [
    withoutThemeBlocks(read("theme.css")),
    read("base.css"),
    read("animation.css"),
    read("components.css"),
    read("components/dialog.css"),
    read("components/popover.css"),
    read("components/terminal-output.css"),
  ].join("\n"),
);
const defined = new Set([
  ...themeTokenNames.map((name) => `--${name}`),
  ...[...frameCss.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!),
]);

test("the frame base CSS has no per-theme value blocks", () => {
  assert.doesNotMatch(frameCss, /data-theme="/);
});

test("every custom property the utilities and base styles resolve is an input token or defined for frames", () => {
  // Not theme-derived: properties with a fallback, ones components set inline (`--stream-*`,
  // `--transcript-*`) and bits-ui's runtime sizing (`--bits-*`).
  const referenced = new Set(
    [...frameCss.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)]
      .filter((match) => match[2] === ")")
      .map((match) => match[1]!),
  );
  const missing = [...referenced].filter(
    (name) =>
      !defined.has(name) && !/^--(?:tw|bits|stream|transcript)-/.test(name),
  );
  assert.deepEqual(missing, []);
});

test("derived tokens frames rely on are defined from the inputs", () => {
  for (const name of [
    "card",
    "popover",
    "panel",
    "well",
    "muted",
    "muted-foreground",
    "border",
    "input",
    "hover",
    "selected",
    "well-on-background",
    "well-on-panel",
    "radius",
  ])
    assert.ok(defined.has(`--${name}`), `--${name}`);
});
