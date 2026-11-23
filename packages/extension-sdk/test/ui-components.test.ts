import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

const names = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].map((match) => match[1]!).sort();

// The UI kit's sources need the Svelte compiler, so the SDK types them by hand (src/components/components.d.ts).
void test("the typed component list matches what components.impl.ts exports", async () => {
  const implementation = await readFile(
    new URL("../src/components/components.impl.ts", import.meta.url),
    "utf8",
  );
  const types = await readFile(
    new URL("../src/components/components.d.ts", import.meta.url),
    "utf8",
  );
  const exported = [
    ...implementation.matchAll(/^export \{([^}]+)\} from/gm),
  ].flatMap((match) =>
    match[1]!
      .split(",")
      .map((name) => name.trim().replace(/^\w+ as /, ""))
      .filter(Boolean),
  );
  const namespaces = names(implementation, /^export \* as (\w+) from/gm);
  const typed = names(types, /^export (?:const|function) (\w+)/gm);
  assert.deepEqual(typed, [...exported, ...namespaces].sort());
});

void test("frames cannot reach the components that need to draw outside them", async () => {
  const implementation = await readFile(
    new URL("../src/components/components.impl.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    implementation,
    /\/(dialog|alert-dialog|sheet|context-menu|dropdown-menu|sonner)"/,
  );
});

// `@nervekit/extension-sdk/ui` exports every Lucide icon next to the components. A component
// with an icon's name shadows it (its icon stays available as `<Name>Icon`), so each shadowing
// must be explicit in src/ui.ts and listed here.
void test("component names that shadow a Lucide icon are explicit exports of src/ui.ts", async () => {
  const dist = dirname(
    createRequire(import.meta.url).resolve("@lucide/svelte"),
  );
  const icons = new Set<string>();
  for (const file of [
    "icons/index.js",
    "aliases/index.js",
    "aliases/aliases.js",
    "aliases/prefixed.js",
    "aliases/suffixed.js",
  ])
    for (const match of (await readFile(join(dist, file), "utf8")).matchAll(
      / as (\w+) \}/g,
    ))
      icons.add(match[1]!);
  const types = await readFile(
    new URL("../src/components/components.d.ts", import.meta.url),
    "utf8",
  );
  const components = names(types, /^export (?:const|function) (\w+)/gm);
  const shadowing = components.filter((name) => icons.has(name));
  assert.deepEqual(shadowing, ["Badge"]);
  const entry = await readFile(
    new URL("../src/ui.ts", import.meta.url),
    "utf8",
  );
  for (const name of shadowing)
    assert.match(
      entry,
      new RegExp(`export \\{ ${name} \\} from "./components/components.js"`),
    );
});
