import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileModule, parse } from "svelte/compiler";
import ts from "typescript";

void test("draft model replacements do not reset completion; changed sources still do", async () => {
  const component = await readFile(
    new URL(
      "../../../presentation/composer/ComposerEditor.svelte",
      import.meta.url,
    ),
    "utf8",
  );
  const instance = parse(component, { modern: true }).instance?.content as
    | { start: number; end: number }
    | undefined;
  assert.ok(instance);
  const script = component.slice(instance.start, instance.end);
  const source = ts.createSourceFile(
    "ComposerEditor.ts",
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const derived: string[] = [];
  let effect: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableStatement(node) &&
      node.getText(source).startsWith("const completion") &&
      node.getText(source).includes("$derived(")
    )
      derived.push(node.getText(source));
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "$effect" &&
      node.getText(source).includes("completionCompartment.reconfigure")
    )
      effect = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(effect, "exercise the production completion-reset effect");
  // Svelte component props can be getters into a larger replaced model. Keep
  // those broad dependencies here rather than pre-deduplicating the test props.
  const production = [...derived, effect]
    .join("\n")
    .replace(
      /\b(slashCompletions|fileCompletions|referenceCompletions|completionSource)\b/g,
      "props.$1",
    );
  const compiled = compileModule(
    `
let model = $state.raw({ text: '', slashCompletions: [], completionSource: {} });
const props = {
  get slashCompletions() { return model.slashCompletions; },
  get fileCompletions() { return model.fileCompletions; },
  get referenceCompletions() { return model.referenceCompletions; },
  get completionSource() { return model.completionSource; }
};
let resets = 0;
let completionNotice = '';
const completionOptions = {};
const view = { dispatch() {} };
const completionCompartment = { reconfigure() {} };
function invalidateComposerCompletionRequests() { resets++; }
function closeCompletion() {}
function composerCompletionExtensions() { return []; }
${production.slice(0, production.indexOf("$effect("))}
export const stop = $effect.root(() => {
  ${production.slice(production.indexOf("$effect("))};
});
export function edit() { model = { ...model, text: model.text + 'a' }; }
export function changeSource() { model = { ...model, completionSource: {} }; }
export function changeSlashItems() { model = { ...model, slashCompletions: [] }; }
export function count() { return resets; }
`,
    {
      filename: "composer-completion-reactivity.svelte.js",
      generate: "client",
    },
  ).js.code;
  const runtimeUrl = import.meta.resolve("svelte/internal/client");
  const code = compiled.replace(
    /(['"])svelte\/internal\/client\1/g,
    JSON.stringify(runtimeUrl),
  );
  const harness = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as {
    stop(): void;
    edit(): void;
    changeSource(): void;
    changeSlashItems(): void;
    count(): number;
  };
  const publicClientUrl = import.meta
    .resolve("svelte")
    .replace(/index-server\.js$/, "index-client.js");
  const { flushSync } = (await import(publicClientUrl)) as {
    flushSync(): void;
  };
  try {
    flushSync();
    assert.equal(harness.count(), 1);
    for (let i = 0; i < 5; i++) {
      harness.edit();
      flushSync();
    }
    assert.equal(harness.count(), 1, "typing must not close autocomplete");
    harness.changeSource();
    flushSync();
    assert.equal(harness.count(), 2);
    harness.changeSlashItems();
    flushSync();
    assert.equal(harness.count(), 3);
  } finally {
    harness.stop();
  }
});
