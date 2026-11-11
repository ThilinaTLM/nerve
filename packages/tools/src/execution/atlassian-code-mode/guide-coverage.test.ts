import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sdkMethodNames } from "./sdk.js";
import { STORAGE_PRELUDE } from "./storage-helpers.js";

// Works from src/ (tsx) and dist/: walk up to the packages directory.
function guideDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(
      dir,
      "skills",
      "src",
      "guides",
      "atlassian-code-mode",
    );
    try {
      readFileSync(join(candidate, "SKILL.md"));
      return candidate;
    } catch {
      const parent = dirname(dir);
      assert.notEqual(parent, dir, "atlassian-code-mode guide not found");
      dir = parent;
    }
  }
}

function storageHelpers(): string[] {
  const returned = STORAGE_PRELUDE.slice(
    STORAGE_PRELUDE.lastIndexOf("return {"),
  );
  return [...returned.matchAll(/^\s{4}(\w+)(?::|,)/gm)].map(
    (m) => `storage.${m[1]}`,
  );
}

const dir = guideDir();
const reference = (name: string) => readFileSync(join(dir, name), "utf8");

const PRODUCTS = [
  "jira",
  "confluence",
  "storage",
  "diagram",
  "files",
  "image",
] as const;

for (const product of PRODUCTS) {
  // `diagram.render` is documented next to the Confluence attachment methods;
  // `files.*` and the `image(handle)` chain share files.md.
  const file =
    product === "diagram"
      ? "confluence.md"
      : product === "image"
        ? "files.md"
        : `${product}.md`;
  const known =
    product === "storage"
      ? storageHelpers()
      : sdkMethodNames().filter((n) => n.startsWith(`${product}.`));

  void test(`${file} documents every ${product} method and nothing else`, () => {
    assert.ok(known.length > 0);
    const text = reference(file);
    for (const name of known) {
      // The image chain is documented as `.info()` / `.save(name)`.
      const marker =
        product === "image"
          ? `\`.${name.slice("image.".length)}(`
          : `\`${name}(`;
      assert.ok(text.includes(marker), `${file} misses ${marker}`);
    }
    const mentioned = new Set(
      [
        ...text.matchAll(
          new RegExp(`\\b${product}(?:\\.\\w+){1,2}(?=\\()`, "g"),
        ),
      ].map((m) => m[0]),
    );
    for (const name of mentioned) {
      assert.ok(known.includes(name), `${file} mentions unknown ${name}(`);
    }
  });
}
