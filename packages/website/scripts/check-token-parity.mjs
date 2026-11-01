import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* The website follows ui-kit's token model (see the header of ui-kit's
 * theme.css): a theme is a few colour inputs, and the rest is derived by shared
 * recipes from per-mode steps. Parity therefore compares
 * - the inputs, literally;
 * - the resolved steps (`--step-card`, `--mix-*`, `--on-solid`): the ui-kit
 *   theme's override, else the ui-kit default for its mode;
 * - the derivation recipes of the tokens the website uses, textually. */
export const sharedInputTokens = Object.freeze([
  "background",
  "foreground",
  "primary",
  "success",
  "warning",
  "info",
  "destructive",
]);
export const sharedStepTokens = Object.freeze([
  "step-card",
  "mix-muted",
  "mix-border",
  "mix-muted-foreground",
  "on-solid",
]);
export const sharedRecipeTokens = Object.freeze([
  "card",
  "muted",
  "border",
  "muted-foreground",
  "primary-foreground",
  "success-foreground",
  "warning-foreground",
  "info-foreground",
  "destructive-foreground",
]);

export function compareTokenParity(uiKitCss, websiteCss) {
  const shared = declarationsAt(
    uiKitCss,
    /:root,\s*\[data-theme-preview\]\s*\{/,
  );
  const modeDefaults = {
    light: [
      declarationsAt(uiKitCss, /:where\(:root, \[data-theme-preview\]\)\s*\{/),
      shared,
    ],
    dark: [
      declarationsAt(
        uiKitCss,
        /\n\.dark,\s*\[data-theme-preview\]\[data-color-mode="dark"\]\s*\{/,
      ),
      declarationsAt(
        uiKitCss,
        /:where\(\.dark, \[data-theme-preview\]\[data-color-mode="dark"\]\)\s*\{/,
      ),
      shared,
    ],
  };
  const failures = [];

  for (const [mode, uiSelector, websiteSelector] of [
    ["light", ':root[data-theme="nerve-light"]', ':root[data-theme="light"]'],
    ["dark", ':root[data-theme="nerve-dark"]', ':root[data-theme="dark"]'],
  ]) {
    const uiTheme = themeDeclarations(uiKitCss, uiSelector);
    const website = themeDeclarations(websiteCss, websiteSelector);
    const resolveUi = (token) =>
      [uiTheme, ...modeDefaults[mode]]
        .map((declarations) => declarations.get(token))
        .find((value) => value !== undefined);
    const report = (token, expected, actual) => {
      if (expected !== actual)
        failures.push(
          `${mode} --${token}: expected ${expected ?? "<missing>"}, found ${actual ?? "<missing>"}`,
        );
    };

    for (const token of sharedInputTokens)
      report(token, uiTheme.get(token), website.get(token));
    for (const token of sharedStepTokens)
      report(token, resolveUi(token), website.get(token));
    for (const token of sharedRecipeTokens)
      report(token, shared.get(token), website.get(token));
  }
  return failures;
}

function declarationsAt(css, selectorPattern) {
  const match = selectorPattern.exec(css);
  if (!match) throw new Error(`Missing block ${selectorPattern}`);
  return declarationsFrom(css, match.index + match[0].length - 1);
}

function themeDeclarations(css, selectorMarker) {
  const selectorIndex = css.indexOf(selectorMarker);
  if (selectorIndex < 0)
    throw new Error(`Missing theme selector ${selectorMarker}`);
  return declarationsFrom(css, css.indexOf("{", selectorIndex));
}

function declarationsFrom(css, blockStart) {
  const blockEnd = css.indexOf("}", blockStart);
  if (blockStart < 0 || blockEnd < 0) throw new Error("Incomplete theme block");
  const declarations = new Map();
  for (const match of css
    .slice(blockStart + 1, blockEnd)
    .matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g))
    declarations.set(match[1], normalizeValue(match[2]));
  return declarations;
}

function normalizeValue(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .toLowerCase();
}

function main() {
  const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = join(websiteRoot, "..", "..");
  const uiKitCss = readFileSync(
    join(repoRoot, "packages/ui-kit/src/styles/theme.css"),
    "utf8",
  );
  const websiteCss = readFileSync(
    join(websiteRoot, "src/styles/tokens.css"),
    "utf8",
  );
  const failures = compareTokenParity(uiKitCss, websiteCss);
  if (failures.length === 0) return;
  console.error("Website theme token parity check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
