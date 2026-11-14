import assert from "node:assert/strict";
import { mkdir, mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { QuickScriptNestedRequest } from "../../execution/index.js";
import type { SdkEnvironment } from "../runtime/sdk-types.js";
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
    risk: "network",
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
      risk: "network",
    },
  ]);
});

void test("ctx.authorize refuses a check above the declared risk, before any approval", async () => {
  const { runtime, nested } = setup();
  const ctx = runtime.context(demoExtension, {
    name: "demo.items.get",
    risk: "network",
  });
  await assert.rejects(
    ctx.authorize({
      operation: "demo.items.delete",
      targets: ["demo:item/1"],
      risk: "destructive",
    }),
    /declares risk "network" but is authorized as demo\.items\.delete/,
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
