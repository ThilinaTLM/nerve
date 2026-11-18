import assert from "node:assert/strict";
import test from "node:test";
import { themeTokenNames } from "@nervekit/contracts/extensions";
import { themeTokensSnapshot } from "./theme-snapshot";

test("snapshots every token the document defines, in contract order", () => {
  const css = themeTokensSnapshot((property) =>
    property === "--background"
      ? " #112233 "
      : property === "--primary"
        ? "oklch(0.7 0.1 40)"
        : "",
  );
  assert.equal(css, "--background:#112233;--primary:oklch(0.7 0.1 40);");
  assert.equal(themeTokenNames[0], "background");
});

test("values that could break out of a declaration are skipped", () => {
  assert.equal(
    themeTokensSnapshot(() => "red; } body { x: y"),
    "",
  );
});
