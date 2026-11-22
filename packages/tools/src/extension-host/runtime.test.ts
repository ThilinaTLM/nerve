import assert from "node:assert/strict";
import { mkdir, mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { QuickScriptNestedRequest } from "../execution/index.js";
import type { SdkEnvironment } from "../quick-script/runtime/sdk-types.js";
import { ExtensionError } from "@nervekit/extension-api";
import { ExtensionRuntime } from "./runtime.js";
import { demoExtension } from "./test-extension.js";

function setup(conversationDir = "/nonexistent") {
  const nested: QuickScriptNestedRequest[] = [];
  const env = {
    context: {
      cwd: "/work",
      conversationDir,
      extensionPorts: {
        settings: () => ({}),
        accounts: { get: async () => undefined, secret: async () => undefined },
      },
      authorizeNested: async (request: QuickScriptNestedRequest) => {
        nested.push(request);
      },
    },
    report: {
      artifacts: new Map(),
      created: [],
      updated: [],
      deleted: [],
      notes: [],
      raw: [],
    },
  } as unknown as SdkEnvironment;
  return { runtime: new ExtensionRuntime(env), nested };
}

void test("ctx.authorize goes through the nested approval path, within the call's declared risk", async () => {
  const { runtime, nested } = setup();
  const ctx = runtime.context(demoExtension, {
    name: "demo.items.update",
    risk: "external_write",
  });
  await ctx.authorize({
    operation: "demo.items.update",
    targets: ["demo:item/1"],
    risk: "external_write",
  });
  await ctx.authorize({
    operation: "demo.items.update",
    targets: ["demo:item/1"],
    risk: "external_read",
  });
  assert.deepEqual(nested, [
    {
      operation: "demo.items.update",
      targets: ["demo:item/1"],
      risk: "external_write",
    },
    {
      operation: "demo.items.update",
      targets: ["demo:item/1"],
      risk: "external_read",
    },
  ]);
});

void test("ctx.authorize refuses a check above the declared risk, before any approval", async () => {
  const { runtime, nested } = setup();
  const ctx = runtime.context(demoExtension, {
    name: "demo.items.get",
    risk: "external_read",
  });
  await assert.rejects(
    ctx.authorize({
      operation: "demo.items.delete",
      targets: ["demo:item/1"],
      risk: "destructive",
    }),
    /declares risk "external_read" but is authorized as demo\.items\.delete/,
  );
  assert.deepEqual(nested, []);
  const read = runtime.context(demoExtension, {
    name: "demo.files.size",
    risk: "none",
  });
  await assert.rejects(
    read.authorize({ operation: "demo.x", targets: [], risk: "read" }),
    /declares risk "none"/,
  );
});

void test("ctx.authorize is unavailable outside a method call", async () => {
  const { runtime, nested } = setup();
  await assert.rejects(
    runtime
      .context(demoExtension)
      .authorize({ operation: "demo.x", targets: [], risk: "read" }),
    /only available inside a method call/,
  );
  assert.deepEqual(nested, []);
});

void test("upload file handles stream up to 100 MB, not the 20 MB read limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rt-"));
  await mkdir(join(dir, "quick-script"), { recursive: true });
  const sparse = async (name: string, size: number) => {
    const file = await open(join(dir, "quick-script", name), "w");
    await file.truncate(size);
    await file.close();
  };
  await sparse("mid.bin", 60 * 1024 * 1024);
  await sparse("huge.bin", 101 * 1024 * 1024);
  const { runtime } = setup(dir);
  const { artifacts } = runtime.context(demoExtension);
  assert.equal(
    (await artifacts.info("artifact:mid.bin")).bytes,
    60 * 1024 * 1024,
  );
  await assert.rejects(
    artifacts.read("artifact:mid.bin"),
    /the limit is 20 MB/,
  );
  await assert.rejects(
    artifacts.info("artifact:huge.bin"),
    /the limit is 100 MB/,
  );
});

void test("ctx.extensionStore maps store errors and rejects without a project", async () => {
  const { runtime } = setup();
  const none = runtime.context(demoExtension).extensionStore;
  await assert.rejects(
    none.get("a"),
    (error: unknown) =>
      error instanceof ExtensionError &&
      error.code === "BAD_REQUEST" &&
      error.message === "No project is open.",
  );

  const calls: unknown[][] = [];
  const failWith = (code: string) => Object.assign(new Error(code), { code });
  const env = {
    context: {
      cwd: "/work",
      extensionPorts: {
        settings: () => ({}),
        accounts: { get: async () => undefined, secret: async () => undefined },
        extensionStore: {
          get: async (...args: unknown[]) => {
            calls.push(args);
            return undefined;
          },
          set: async (_id: string, key: string) => {
            throw failWith(key === "big" ? "too_large" : "conflict");
          },
          delete: async () => undefined,
          keys: async () => [],
        },
      },
    },
    report: { artifacts: new Map() },
  } as unknown as SdkEnvironment;
  const store = new ExtensionRuntime(env).context(demoExtension).extensionStore;
  await store.get("k");
  assert.deepEqual(calls, [[demoExtension.id, "k"]]);
  await assert.rejects(
    store.set("k", 1, { ifRevision: 3 }),
    (error: unknown) =>
      error instanceof ExtensionError && error.code === "CONFLICT",
  );
  await assert.rejects(
    store.set("big", 1),
    (error: unknown) =>
      error instanceof ExtensionError && error.code === "BAD_REQUEST",
  );
});

void test("ctx.models accept only the extension's own model settings and Nerve's default", async () => {
  const requests: unknown[] = [];
  const chosen = {
    provider: "p",
    modelId: "m",
    reasoningLevel: "low" as const,
  };
  const fallback = {
    provider: "d",
    modelId: "default",
    reasoningLevel: "off" as const,
  };
  const env = {
    context: {
      cwd: "/work",
      conversationDir: "/nonexistent",
      extensionPorts: {
        settings: () => ({
          summaryModel: chosen,
          image: { provider: "openai-codex", modelId: "gpt-image" },
        }),
        accounts: { get: async () => undefined, secret: async () => undefined },
        completeText: async (request: unknown) => {
          requests.push(request);
          return { text: "done", model: "p/m" };
        },
        textReady: async () => true,
        explainImage: async () => ({ text: "", model: "" }),
        visionReady: async () => true,
        defaultModel: async () => fallback,
      },
    },
    report: { artifacts: new Map() },
  } as unknown as SdkEnvironment;
  const extension = {
    ...demoExtension,
    settings: {
      ...demoExtension.settings,
      fields: {
        ...demoExtension.settings.fields,
        summaryModel: { type: "model", label: "Model", reasoning: true },
        otherModel: { type: "model", label: "Other" },
        image: { type: "imageModel", label: "Image" },
      },
    },
    permissions: { capabilities: ["models.text" as const] },
  } as typeof demoExtension;
  const { models } = new ExtensionRuntime(env).context(extension);
  // Only the declared capability: no vision although the host offers it.
  assert.equal(models.vision, undefined);
  assert.deepEqual(await models.defaultModel!(), fallback);
  await models.text!.complete({ model: chosen, prompt: "hi" });
  // A sandbox round trip leaves `reasoningLevel` absent rather than undefined; both sides normalize.
  await models.text!.complete({ model: { ...fallback }, prompt: "hi" });
  assert.deepEqual(
    requests.map((request) => (request as { model: unknown }).model),
    [chosen, fallback],
  );
  for (const model of [
    { ...chosen, reasoningLevel: "high" },
    { provider: "p", modelId: "other" },
    // The value of an `imageModel` field is not a chat model choice.
    { provider: "openai-codex", modelId: "gpt-image" },
  ] as const) {
    await assert.rejects(
      models.text!.complete({ model: model, prompt: "hi" }),
      (error: unknown) =>
        error instanceof ExtensionError && error.code === "DENIED",
    );
    assert.equal(await models.text!.ready({ model: model }), false);
  }
  await assert.rejects(
    models.text!.complete({ model: "summaryModel" as never, prompt: "hi" }),
    (error: unknown) =>
      error instanceof ExtensionError && error.code === "BAD_REQUEST",
  );
  assert.equal(await models.text!.ready({ model: chosen }), true);
  assert.equal(await models.text!.ready(), false);
});
