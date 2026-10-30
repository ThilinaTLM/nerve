import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
import type { ComposerViewDependencies } from "./composer-view.svelte";

const clientUrl = import.meta
  .resolve("svelte")
  .replace(/index-server\.js$/, "index-client.js");
const { flushSync } = (await import(clientUrl)) as { flushSync(): void };
async function harness() {
  let source = await readFile(
    new URL("./composer-view.svelte.ts", import.meta.url),
    "utf8",
  );
  source = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  source = source
    .replace(
      /from "(\.[^"]+)"/g,
      (_, path: string) =>
        `from ${JSON.stringify(new URL(path + ".ts", import.meta.url).href)}`,
    )
    .replace(
      '"$lib/presentation/utils/model"',
      JSON.stringify(
        new URL("../../presentation/utils/model.ts", import.meta.url).href,
      ),
    );
  source += `\nexport function mount(deps) { let view; const stop = $effect.root(() => { view = createComposerView(deps); }); return { view, stop }; }`;
  const code = compileModule(source, {
    filename: "composer-view.svelte.js",
    generate: "client",
  })
    .js.code.replace(
      /(['"])svelte\/internal\/client\1/g,
      JSON.stringify(import.meta.resolve("svelte/internal/client")),
    )
    .replace(/(['"])svelte\1/g, JSON.stringify(clientUrl));
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as {
    mount(deps: ComposerViewDependencies): {
      view: ReturnType<
        typeof import("./composer-view.svelte").createComposerView
      >;
      stop(): void;
    };
  };
}
function available(locked = false) {
  return {
    status: "available" as const,
    appliedProfile: { name: "coding" },
    inherited: {},
    resolution: {
      settings: {
        model: { provider: "openai", modelId: "test" },
        reasoningLevel: "off" as const,
      },
      provenance: locked
        ? Object.fromEntries(
            [
              "/model",
              "/reasoningLevel",
              "/permissionRuleSetId",
              "/compaction/threshold",
            ].map((p) => [p, { source: "requirement", profile: "coding" }]),
          )
        : {},
      diagnostics: [],
    },
    diagnostics: [],
  };
}
// Test doubles intentionally omit unrelated wire metadata.
function setup() {
  let pending = { id: "draft", projectId: "project", overrides: {} };
  let target = { kind: "draft", pendingId: "draft", projectId: "project" };
  let defaults = available();
  let invalidate = () => {};
  const requests: { resolve(value: unknown): void; input: unknown }[] = [];
  const writes: unknown[] = [];
  const deps = {
    target: () => target,
    pending: () => pending,
    store: () => ({
      effective: defaults,
      configuration: { status: "available", overrides: {}, inherited: {} },
      configure: async (...args: unknown[]) => {
        writes.push(args);
      },
      setAgentProfile: async (...args: unknown[]) => {
        writes.push(args);
      },
    }),
    defaults: () => defaults,
    profiles: () => [{ name: "planning", digest: "a".repeat(64) }],
    resolve: (input: unknown) =>
      new Promise((resolve) => requests.push({ resolve, input })),
    clampReasoning: (_key: string, level: string) => level,
    capabilityEditor: {
      load: async () => {},
      save: async (...args: unknown[]) => {
        writes.push(args);
      },
    },
    observe: (callback: () => void) => {
      invalidate = callback;
      return () => {};
    },
  } as unknown as ComposerViewDependencies;
  return {
    deps,
    requests,
    writes,
    invalidate: () => invalidate(),
    pending: () => pending,
    setPending: (value: unknown) => {
      pending = value as typeof pending;
      invalidate();
    },
    setTarget: (value: unknown) => {
      target = value as typeof target;
      invalidate();
    },
    lock: () => {
      defaults = available(true);
      invalidate();
    },
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
};

test("untouched drafts use shared defaults; customized drafts resolve once and discard older replies", async () => {
  const { mount } = await harness();
  const s = setup();
  const { view, stop } = mount(s.deps);
  try {
    flushSync();
    assert.equal(view.status, "ready");
    assert.equal(s.requests.length, 0);
    s.setPending({ ...s.pending(), explicitAgentProfile: "planning" });
    flushSync();
    assert.equal(s.requests.length, 1);
    s.setPending({
      ...s.pending(),
      explicitAgentProfile: "planning",
      overrides: { permissionRuleSetId: "read_only" },
    });
    flushSync();
    assert.equal(s.requests.length, 2);
    const newer = available();
    newer.resolution.settings.model.modelId = "newer";
    s.requests[1]!.resolve(newer);
    await settle();
    s.requests[0]!.resolve(available());
    await settle();
    assert.equal(view.resolution?.settings.model?.modelId, "newer");
  } finally {
    stop();
  }
});

test("draft and saved actions enforce locks; sub-agent views reject every action", async () => {
  const { mount } = await harness();
  for (const saved of [false, true]) {
    const s = setup();
    s.lock();
    if (saved)
      s.setTarget({
        kind: "conversation",
        conversationId: "saved",
        readOnly: false,
      });
    const { view, stop } = mount(s.deps);
    try {
      flushSync();
      await view.setModel("openai:other");
      await view.setReasoning("high");
      await view.setPermission("read_only");
      await view.patchCapabilities(
        { model: { provider: "openai", modelId: "other" } },
        ["/overrides/compaction/threshold"],
      );
      assert.deepEqual(s.writes, []);
      assert.deepEqual(s.pending().overrides, {});
      s.setTarget({
        kind: "conversation",
        conversationId: "child",
        readOnly: true,
      });
      flushSync();
      await view.setModel("openai:other");
      await view.setReasoning("high");
      await view.setPermission("read_only");
      await view.setProfile("planning");
      await view.patchCapabilities({ skills: { file: { example: true } } });
      assert.deepEqual(s.writes, []);
    } finally {
      stop();
    }
  }
});

test("unlocked draft edits store only intent and resolve overrides once", async () => {
  const { mount } = await harness();
  const s = setup();
  const { view, stop } = mount(s.deps);
  try {
    flushSync();
    await view.setModel("openai:other");
    assert.deepEqual(s.pending().overrides, {
      model: { provider: "openai", modelId: "other" },
      reasoningLevel: "off",
    });
    s.invalidate();
    flushSync();
    assert.equal(s.requests.length, 1);
    assert.deepEqual(
      (s.requests[0]!.input as { overrides: unknown }).overrides,
      s.pending().overrides,
    );
  } finally {
    stop();
  }
});

test("read-only views reject edits even without profile locks", async () => {
  const { mount } = await harness();
  const s = setup();
  s.setTarget({
    kind: "conversation",
    conversationId: "child",
    readOnly: true,
  });
  const { view, stop } = mount(s.deps);
  try {
    flushSync();
    await view.setModel("openai:other");
    await view.setReasoning("high");
    await view.setPermission("read_only");
    await view.setProfile("planning");
    await view.patchCapabilities({ skills: { file: { example: true } } });
    assert.deepEqual(s.writes, []);
    assert.equal(s.requests.length, 0);
  } finally {
    stop();
  }
});

test("a resolved configuration without a model is unavailable, not a draft-creation error", async () => {
  const { mount } = await harness();
  const s = setup();
  const defaults = s.deps.defaults("project");
  assert.ok(defaults?.status === "available");
  s.deps.defaults = () => ({
    ...defaults,
    resolution: { ...defaults.resolution, settings: {} },
  });
  const { view, stop } = mount(s.deps);
  try {
    flushSync();
    assert.equal(view.status, "unavailable");
    assert.match(view.error ?? "", /model/);
    assert.equal(s.requests.length, 0);
  } finally {
    stop();
  }
});
