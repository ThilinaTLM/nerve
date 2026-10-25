import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileModule, parse } from "svelte/compiler";
import ts from "typescript";

void test("capability edits preserve the view; scope and project changes reset it", async () => {
  const component = await readFile(
    new URL("./WorkbenchComposerAdapter.svelte", import.meta.url),
    "utf8",
  );
  const instance = parse(component, { modern: true }).instance?.content as
    | { start: number; end: number }
    | undefined;
  assert.ok(instance);
  const source = ts.createSourceFile(
    "adapter.ts",
    component.slice(instance.start, instance.end),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let scope: string | undefined;
  let effect: string | undefined;
  function visit(node: ts.Node): void {
    if (
      ts.isVariableStatement(node) &&
      node.getText(source).startsWith("const capabilityScopeKey =")
    )
      scope = node.getText(source);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "$effect" &&
      node.getText(source).includes("capabilityRefreshGeneration += 1")
    )
      effect = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(scope);
  assert.ok(effect);
  // Exercise the production dependency boundary with the same incidental
  // preference reads made synchronously by refreshCapabilities.
  const compiled = compileModule(
    `
import { untrack } from 'svelte';
let workbenchStartupState = $state({ progressiveActive: true });
let activeProject = $state({ id: 'p' });
let activeConversation = $state(null);
let activePendingConversation = $state({ id: 'draft', overrides: { subagents: { developer: { enabled: true } } } });
let capabilityRefreshGeneration = 0;
let capabilitySkills = [];
let pendingCapabilityResolution = $state('ready');
let capabilityError;
let capabilityEditor = {};
let configuringToolGroup;
let refreshes = 0;
async function refreshCapabilities() {
  void activePendingConversation.overrides.subagents.developer.enabled;
  refreshes++;
}
${scope}
export const stop = $effect.root(() => { ${effect}; });
export function edit() { activePendingConversation.overrides.subagents.developer.enabled = false; }
export function replaceDraft() { activePendingConversation = { ...activePendingConversation, overrides: { subagents: { developer: { enabled: true } } } }; }
export function switchScope() { activePendingConversation.id = 'other-draft'; }
export function switchProject() { activeProject.id = 'other-project'; }
export function publish() { pendingCapabilityResolution = 'ready'; }
export function view() { return { refreshes, resolution: pendingCapabilityResolution }; }
`,
    { filename: "composer-capabilities.svelte.js", generate: "client" },
  ).js.code;
  const clientUrl = import.meta
    .resolve("svelte")
    .replace(/index-server\.js$/, "index-client.js");
  const code = compiled
    .replace(
      /(['"])svelte\/internal\/client\1/g,
      JSON.stringify(import.meta.resolve("svelte/internal/client")),
    )
    .replace(/(['"])svelte\1/g, JSON.stringify(clientUrl));
  const harness = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as {
    stop(): void;
    edit(): void;
    replaceDraft(): void;
    switchScope(): void;
    switchProject(): void;
    publish(): void;
    view(): { refreshes: number; resolution?: string };
  };
  const { flushSync } = (await import(clientUrl)) as { flushSync(): void };
  try {
    flushSync();
    assert.equal(harness.view().refreshes, 1);
    harness.publish();
    flushSync();
    harness.edit();
    flushSync();
    harness.replaceDraft();
    flushSync();
    assert.deepEqual(harness.view(), { refreshes: 1, resolution: "ready" });
    harness.switchScope();
    flushSync();
    assert.deepEqual(harness.view(), { refreshes: 2, resolution: undefined });
    harness.publish();
    harness.switchProject();
    flushSync();
    assert.deepEqual(harness.view(), { refreshes: 3, resolution: undefined });
  } finally {
    harness.stop();
  }
});
