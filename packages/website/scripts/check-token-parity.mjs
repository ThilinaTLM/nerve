import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sharedThemeTokens = Object.freeze([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "muted",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "border",
  "ring",
  "success",
  "warning",
  "info",
  "destructive",
]);

export function compareTokenParity(uiKitCss, websiteCss) {
  const uiLight = themeDeclarations(uiKitCss, ':root[data-theme="nerve"]');
  const uiDark = themeDeclarations(uiKitCss, ':root[data-theme="nerve"].dark');
  const websiteDark = themeDeclarations(websiteCss, ':root[data-theme="dark"]');
  const websiteLight = themeDeclarations(
    websiteCss,
    ':root[data-theme="light"]',
  );
  const failures = [];

  for (const [mode, expected, actual] of [
    ["light", uiLight, websiteLight],
    ["dark", uiDark, websiteDark],
  ]) {
    for (const token of sharedThemeTokens) {
      const expectedValue = expected.get(token);
      const actualValue = actual.get(token);
      if (expectedValue !== actualValue)
        failures.push(
          `${mode} --${token}: expected ${expectedValue ?? "<missing>"}, found ${actualValue ?? "<missing>"}`,
        );
    }
  }
  return failures;
}

function themeDeclarations(css, selectorMarker) {
  const selectorIndex = css.indexOf(selectorMarker);
  if (selectorIndex < 0)
    throw new Error(`Missing theme selector ${selectorMarker}`);
  const blockStart = css.indexOf("{", selectorIndex);
  const blockEnd = css.indexOf("}", blockStart);
  if (blockStart < 0 || blockEnd < 0)
    throw new Error(`Incomplete theme block for ${selectorMarker}`);
  const declarations = new Map();
  for (const match of css
    .slice(blockStart + 1, blockEnd)
    .matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g))
    declarations.set(match[1], normalizeValue(match[2]));
  return declarations;
}

function normalizeValue(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
