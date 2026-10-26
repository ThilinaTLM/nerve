import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileModule, parse } from "svelte/compiler";
import ts from "typescript";

void test("pending composer retains settings during refresh without leaking targets or stale responses", async () => {
  const component = await readFile(
    new URL("./ConversationCenterHost.svelte", import.meta.url),
    "utf8",
  );
  const instance = parse(component, { modern: true }).instance?.content as
    | { start: number; end: number }
    | undefined;
  assert.ok(instance);
  const source = ts.createSourceFile(
    "center.ts",
    component.slice(instance.start, instance.end),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let effect: string | undefined;
  const derived: string[] = [];
  const fields = [
    "composerResolution",
    "selectedModelKey",
    "selectedThinkingLevel",
    "selectedPermissionRuleSetId",
    "lockedFields",
  ];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "$effect" &&
      node
        .getText(source)
        .includes('requestConversation("agentConfiguration.resolveProject"')
    )
      effect = node.getText(source);
    if (
      ts.isVariableStatement(node) &&
      fields.some((field) =>
        node.getText(source).startsWith(`const ${field} =`),
      )
    )
      derived.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  assert.equal(derived.length, fields.length);
  const compiled = compileModule(
    `
const DEFAULT_AGENT_PROFILE = 'coding';
let pendingConfigurationRevision = $state(0);
let creationDefaults = $state({ defaultAgentProfile: 'coding' });
let activePendingConversation = $state({ id: 'draft', projectId: 'p', explicitAgentProfile: 'coding', overrides: { count: 0 } });
let resolvedProfiles = $state([{ name: 'coding', digest: 'a' }, { name: 'lead', digest: 'b' }]);
let pendingResolution = $state();
let pendingResolutionTarget;
let projectDefaultView = $state();
const activeProject = {id: "p"};
const effective = undefined;
const selectedAgentProfile = 'coding';
const modelKey = (model) => model.provider + ':' + model.modelId;
const requests = [];
function captureSystemPromptPreview({pending}) {
  void pending.overrides.count;
  return { params: {} };
}
function requestConversation() {
  return new Promise((resolve, reject) => requests.push({resolve, reject}));
}
${derived.join("\n")}
export const stop = $effect.root(() => { ${effect}; });
export function idleWithDefaults() {
  activePendingConversation = undefined;
  projectDefaultView = {status:'available', appliedProfile:{name:'coding'}, resolution:{
    settings:{model:{provider:'test',modelId:'warm'}, reasoningLevel:'high', permissionRuleSetId:'supervised'},
    provenance:{'/model':{source:'requirement'}}
  }};
}
export function blankDraft() { activePendingConversation = {id:'blank', projectId:'p', overrides:{}}; }
export function edit() { activePendingConversation.overrides.count++; }
export function scope() { activePendingConversation.id += '-next'; }
export function project() { activePendingConversation.projectId += '-next'; }
export function profile(name) { activePendingConversation.explicitAgentProfile = name; }
export function settle(index, modelId) {
  requests[index].resolve(modelId ? { status: 'available', appliedProfile: {name:'coding'}, resolution: {
    settings: { model: {provider:'test', modelId}, reasoningLevel:'high', permissionRuleSetId:'supervised' },
    provenance: { '/model': {source:'requirement'} }
  }} : {status:'unavailable'});
}
export function fail(index) { requests[index].reject(new Error('Unavailable')); }
export function view() { return { model: selectedModelKey, thinking: selectedThinkingLevel, permission: selectedPermissionRuleSetId, locked: lockedFields.model, requests: requests.length }; }
`,
    { filename: "pending-composer-resolution.svelte.js", generate: "client" },
  ).js.code;
  const code = compiled.replace(
    /(['"])svelte\/internal\/client\1/g,
    JSON.stringify(import.meta.resolve("svelte/internal/client")),
  );
  const harness = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as {
    stop(): void;
    idleWithDefaults(): void;
    blankDraft(): void;
    edit(): void;
    scope(): void;
    project(): void;
    profile(name: string): void;
    settle(index: number, modelId?: string): void;
    fail(index: number): void;
    view(): {
      model: string;
      thinking: string;
      permission: string;
      locked: boolean;
      requests: number;
    };
  };
  const clientUrl = import.meta
    .resolve("svelte")
    .replace(/index-server\.js$/, "index-client.js");
  const { flushSync } = (await import(clientUrl)) as { flushSync(): void };
  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
  }
  function assertModel(model: string) {
    const view = harness.view();
    assert.equal(view.model, `test:${model}`);
    assert.equal(view.thinking, "high");
    assert.equal(view.permission, "supervised");
    assert.equal(view.locked, true);
  }
  try {
    flushSync();
    harness.settle(0, "original");
    await flush();
    assertModel("original");
    harness.edit();
    flushSync();
    assert.equal(harness.view().requests, 2);
    assertModel("original");
    harness.edit();
    flushSync();
    harness.settle(1, "stale");
    await flush();
    assertModel("original");
    harness.settle(2, "updated");
    await flush();
    assertModel("updated");
    harness.scope();
    flushSync();
    assert.equal(harness.view().model, "");
    harness.settle(3, "other-draft");
    await flush();
    harness.project();
    flushSync();
    assert.equal(harness.view().model, "");
    harness.settle(4, "other-project");
    await flush();
    harness.profile("lead");
    flushSync();
    assert.equal(harness.view().model, "");
    harness.settle(5, "lead-model");
    await flush();
    assertModel("lead-model");
    harness.edit();
    flushSync();
    assertModel("lead-model");
    harness.fail(6);
    await flush();
    assert.equal(
      harness.view().model,
      "",
      "a failed refresh must not present stale settings as current",
    );
    harness.edit();
    flushSync();
    harness.settle(7);
    await flush();
    assert.equal(harness.view().model, "");
    harness.profile("missing");
    flushSync();
    assert.equal(
      harness.view().requests,
      8,
      "unavailable profiles cannot reuse another profile's preview",
    );
    harness.idleWithDefaults();
    flushSync();
    harness.blankDraft();
    // Warm project settings are available even before the draft's effects run.
    assertModel("warm");
    flushSync();
    assertModel("warm");
    assert.equal(
      harness.view().requests,
      8,
      "blank drafts reuse warmed defaults without another resolution",
    );
  } finally {
    harness.stop();
  }
});
