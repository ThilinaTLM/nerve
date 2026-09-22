import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeImports,
  importSpecifiers,
} from "./repository-source-inventory.mjs";

test("parses static TypeScript imports without matching comments or strings", () => {
  const text = `
    // import "ignored-comment";
    const example = 'require("ignored-string")';
    import type { A } from "types";
    export { value } from "exports";
    import alias = require("equals");
    require("required");
    void import("dynamic-literal");
  `;
  assert.deepEqual([...importSpecifiers(text, "fixture.ts")].sort(), [
    "dynamic-literal",
    "equals",
    "exports",
    "required",
    "types",
  ]);
});

test("parses module and instance Svelte scripts", () => {
  const text = `
    <script context="module">export { value } from "module-import";</script>
    <script lang="ts">
      import Component from "instance-import";
      const fake = 'import "ignored"';
    </script>
    <p>import "markup"</p>
  `;
  assert.deepEqual([...importSpecifiers(text, "Component.svelte")].sort(), [
    "instance-import",
    "module-import",
  ]);
});

test("reports nonliteral dynamic imports with source locations", () => {
  const result = analyzeImports(
    "const module = await import(moduleName);\nvoid import(`./${name}.js`);",
    "loader.ts",
  );
  assert.deepEqual([...result.specifiers], []);
  assert.deepEqual(
    result.nonLiteralDynamicImports.map(({ file, line, column }) => ({
      file,
      line,
      column,
    })),
    [
      { file: "loader.ts", line: 1, column: 22 },
      { file: "loader.ts", line: 2, column: 6 },
    ],
  );
});
