import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defineExtension,
  defineTool,
  type ToolDefinition as ExtensionTool,
} from "@nervekit/extension-api";
import { createQuickScriptRegistry } from "../quick-script/registry.js";
import { createExtensionToolDefinitions } from "./direct-tools.js";

const extension = (tool: ExtensionTool, capabilities?: ["models.vision"]) =>
  defineExtension({
    apiVersion: 1,
    id: "viewer",
    name: "Viewer",
    description: "Test.",
    icon: "eye",
    enabledByDefault: true,
    settings: { version: 1, fields: {} },
    ...(capabilities ? { permissions: { capabilities } } : {}),
    namespaces: [],
    tools: [tool],
  });

const tool = defineTool({
  name: "viewer_explain",
  description: "Explain.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, prompt: { type: "string" } },
  },
  view: {
    header: { argument: "path", format: "path" },
    meta: ["prompt"],
    sections: [
      { id: "thinking", type: "text", live: "transient" },
      { id: "explanation", type: "markdown", live: "stream" },
    ],
  },
  risk: "none",
  parse: () => ({}),
  run: async (_input, ctx) => {
    const result = await ctx.models.vision!.explain({
      image: new Uint8Array([1]),
      progress: { thinking: "thinking", text: "explanation" },
    });
    ctx.progress("elsewhere", "dropped");
    return result.text;
  },
  present: (text: string) => ({ text, sections: { explanation: text } }),
});

type Executor = (
  args: unknown,
  context: unknown,
) => Promise<{ content: string; details: Record<string, unknown> }>;

void test("live sections receive the vision model's deltas as progress streams; the result fills the declared sections", async () => {
  const [definition] = createExtensionToolDefinitions(
    createQuickScriptRegistry([extension(tool, ["models.vision"])]),
  );
  const updates: { stream: string; chunk: string }[] = [];
  const warnings: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), "view-"));
  const result = await (
    definition as unknown as { executor: Executor }
  ).executor(
    {},
    {
      cwd: dir,
      conversationDir: dir,
      onUpdate: (update: { stream: string; chunk: string }) =>
        void updates.push({ stream: update.stream, chunk: update.chunk }),
      extensionPorts: {
        settings: () => ({}),
        accounts: {},
        log: (_level: string, _id: string, message: string) =>
          void warnings.push(message),
        visionReady: async () => true,
        explainImage: async (request: {
          extensionId: string;
          onDelta?: (update: {
            kind: "thinking" | "text";
            delta: string;
          }) => void;
        }) => {
          assert.equal(request.extensionId, "viewer");
          request.onDelta?.({ kind: "thinking", delta: "hmm" });
          request.onDelta?.({ kind: "text", delta: "A cat." });
          return { text: "A cat.", model: "p/m" };
        },
      },
    },
  );
  assert.deepEqual(updates, [
    { stream: "thinking", chunk: "hmm" },
    { stream: "explanation", chunk: "A cat." },
  ]);
  assert.equal(
    warnings.length,
    1,
    "progress into an undeclared section is ignored",
  );
  assert.deepEqual(result.details.sections, [
    { id: "explanation", type: "markdown", value: "A cat." },
  ]);
  assert.deepEqual(definition.extension?.view.header, {
    argument: "path",
    format: "path",
  });
});

void test("ctx.models.vision exists only when the manifest declares the capability", async () => {
  const [definition] = createExtensionToolDefinitions(
    createQuickScriptRegistry([extension(tool)]),
  );
  const dir = await mkdtemp(join(tmpdir(), "view-"));
  await assert.rejects(
    (definition as unknown as { executor: Executor }).executor(
      {},
      {
        cwd: dir,
        conversationDir: dir,
        extensionPorts: {
          settings: () => ({}),
          accounts: {},
          visionReady: async () => true,
          explainImage: async () => ({ text: "x", model: "p/m" }),
        },
      },
    ),
  );
});

void test("the registry rejects views naming unknown arguments, repeated sections or live non-text sections", () => {
  const withView = (view: ExtensionTool["view"]) =>
    extension({ ...tool, view });
  assert.throws(
    () =>
      createQuickScriptRegistry([
        withView({
          header: { argument: "nope" },
          sections: tool.view.sections,
        }),
      ]),
    /unknown argument 'nope'/,
  );
  assert.throws(
    () =>
      createQuickScriptRegistry([
        withView({
          sections: [
            { id: "a", type: "text" },
            { id: "a", type: "markdown" },
          ],
        }),
      ]),
    /repeats section 'a'/,
  );
  assert.throws(
    () =>
      createQuickScriptRegistry([
        withView({ sections: [{ id: "a", type: "links", live: "stream" }] }),
      ]),
    /live but not text or markdown/,
  );
});
