import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const componentsRoot = fileURLToPath(
  new URL("../../../../../ui-kit/src/lib/components/", import.meta.url),
);

/** Directories intentionally absent from the lab, each with its reason. */
const EXEMPT: Record<string, string> = {};

function directories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sectionSources(): string {
  return readdirSync(`${here}sections`)
    .filter((name) => /\.(svelte|ts)$/.test(name))
    .map((name) => readFileSync(`${here}sections/${name}`, "utf8"))
    .join("\n");
}

for (const group of ["ui", "composites"] as const) {
  test(`every ui-kit ${group} component is shown in a design-lab section`, () => {
    const sources = sectionSources();
    const missing = directories(`${componentsRoot}${group}`).filter(
      (name) =>
        !(`${group}/${name}` in EXEMPT) &&
        !new RegExp(`components/${group}/${name}(?:["'/])`).test(sources),
    );
    assert.deepEqual(
      missing,
      [],
      `Add a specimen (Primitives or Composites page) or an EXEMPT entry for: ${missing.join(", ")}`,
    );
  });
}

test("exemptions still refer to existing component directories", () => {
  for (const key of Object.keys(EXEMPT)) {
    const [group, name] = key.split("/");
    assert.ok(
      directories(`${componentsRoot}${group}`).includes(name ?? ""),
      `${key} no longer exists; remove its exemption`,
    );
  }
});
