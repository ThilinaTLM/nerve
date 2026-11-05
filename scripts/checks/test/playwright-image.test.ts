import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { repoRoot } from "../../workspace/repo.ts";

test("the browser CI job runs in the Playwright image matching the installed version", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const images = [
    ...workflow.matchAll(
      /image:\s*mcr\.microsoft\.com\/playwright:v([\d.]+)-/g,
    ),
  ].map((match) => match[1]);
  assert.equal(images.length, 1, "exactly one Playwright image is pinned");
  const { version } = createRequire(`${repoRoot}/package.json`)(
    "@playwright/test/package.json",
  ) as { version: string };
  assert.equal(
    images[0],
    version,
    "update the image tag in .github/workflows/ci.yml to the installed @playwright/test version",
  );
});
