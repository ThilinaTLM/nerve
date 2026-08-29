import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareTokenParity } from "./check-token-parity.mjs";

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

test("website shared theme tokens match the UI-kit Nerve palette", () => {
  assert.deepEqual(compareTokenParity(uiKitCss, websiteCss), []);
});

test("theme token drift is reported with its mode and token", () => {
  const drifted = websiteCss.replace(
    "--primary: oklch(0.57 0.1375 39.0427);",
    "--primary: oklch(0.1 0 0);",
  );
  assert.match(
    compareTokenParity(uiKitCss, drifted).join("\n"),
    /light --primary/,
  );
});
