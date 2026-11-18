import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createQuickScriptRegistry } from "./registry.js";
import { createQuickScriptToolDefinition } from "./tool.js";
import { demoExtension } from "./extension-host/test-extension.js";

void test("the tool runs against the registry of the run, not the one it was created with", async () => {
  // The host creates the tool once with the built-ins and gives each run its project's registry.
  const tool = createQuickScriptToolDefinition(createQuickScriptRegistry([]));
  const root = await mkdtemp(join(tmpdir(), "quick-script-tool-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const result = await (
    tool.executor as (
      args: unknown,
      context: unknown,
    ) => Promise<{ content?: string }>
  )(
    { code: "console.log(typeof demo)" },
    {
      registry: createQuickScriptRegistry([demoExtension]),
      cwd,
      conversationDir: join(root, "conversation"),
      authorizeNested: async () => undefined,
    },
  );
  assert.equal(result.content?.split("\n")[0], "object");
});

void test("the risk of an installed extension's direct tool is read from its project scope", async () => {
  const { setScopedToolDefinitions } = await import("../catalog/tool-scope.js");
  const { quickScriptToolRisk } = await import("./runtime/script-risk.js");
  const { createExtensionToolDefinitions } =
    await import("./extension-host/direct-tools.js");
  const registry = createQuickScriptRegistry([demoExtension]);
  setScopedToolDefinitions(
    "/tmp/risk-scope",
    createExtensionToolDefinitions(registry),
  );
  try {
    assert.doesNotThrow(() =>
      quickScriptToolRisk("demo_item", {}, "/tmp/risk-scope"),
    );
    assert.throws(() => quickScriptToolRisk("demo_item", {}), /Unknown tool/);
  } finally {
    setScopedToolDefinitions("/tmp/risk-scope", []);
  }
});
