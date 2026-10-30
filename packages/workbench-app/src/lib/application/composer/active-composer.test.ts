import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
import type { ComposerView } from "./composer-view.svelte";

test("stale activation cleanup cannot clear a newer pane", async () => {
  const source = ts.transpileModule(
    await readFile(
      new URL("./active-composer.svelte.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const code = compileModule(source, {
    filename: "active-composer.svelte.js",
    generate: "client",
  }).js.code.replace(
    /(['"])svelte\/internal\/client\1/g,
    JSON.stringify(import.meta.resolve("svelte/internal/client")),
  );
  const { activateComposer, activeComposer } = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as typeof import("./active-composer.svelte");
  const first = {} as ComposerView;
  const second = {} as ComposerView;
  const clearFirst = activateComposer(first);
  const clearSecond = activateComposer(second);
  clearFirst();
  assert.equal(activeComposer(), second);
  clearSecond();
  assert.equal(activeComposer(), undefined);
});
