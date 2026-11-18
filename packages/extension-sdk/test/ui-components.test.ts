import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const names = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].map((match) => match[1]!).sort();

// The UI kit's sources need the Svelte compiler, so the SDK types them by hand (src/ui/components.d.ts).
void test("the typed component list matches what ui/components.ts exports", async () => {
  const implementation = await readFile(
    new URL("../ui/components.ts", import.meta.url),
    "utf8",
  );
  const types = await readFile(
    new URL("../src/ui/components.d.ts", import.meta.url),
    "utf8",
  );
  const exported = [
    ...implementation.matchAll(/^export \{([^}]+)\} from/gm),
  ].flatMap((match) =>
    match[1]!
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const namespaces = names(implementation, /^export \* as (\w+) from/gm);
  const typed = names(types, /^export (?:const|function) (\w+)/gm);
  assert.deepEqual(typed, [...exported, ...namespaces].sort());
});

void test("frames cannot reach the components that need to draw outside them", async () => {
  const implementation = await readFile(
    new URL("../ui/components.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    implementation,
    /\/(dialog|alert-dialog|sheet|context-menu|dropdown-menu|sonner)"/,
  );
});
