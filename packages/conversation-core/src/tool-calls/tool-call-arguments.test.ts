import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createId } from "@nervekit/contracts";
import { AssetStore } from "../assets/asset-store.js";
import { ConversationCore } from "../core.js";
import {
  createConversation,
  options,
  waitUntil,
} from "../runtime/lifecycle-test-helpers.js";
import { ToolCallService } from "./tool-call.service.js";

const zero = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "nerve-tool-args-"));
  const config = options(
    directory,
    join(directory, "core.sqlite"),
    {
      resolve: async () => {
        throw new Error("No model expected");
      },
    },
    {
      execute: async () => {
        throw new Error("Dispatch forbidden");
      },
      isReplaySafe: () => false,
    },
  );
  let admissions = 0;
  config.toolHost.prepareExecution = async () => {
    admissions++;
    throw new Error("Preparation forbidden");
  };
  config.permissions.prepareAdmission = async () => {
    admissions++;
    throw new Error("Admission forbidden");
  };
  const core = new ConversationCore(config);
  await createConversation(core, "conv_args");
  const service = new ToolCallService({
    storage: config.storage,
    assets: new AssetStore(directory, config.storage),
    permissions: config.permissions,
    host: config.toolHost,
    coreTools: new Map(),
    emit: () => {},
    asyncBash: {
      adopt: async (): Promise<never> => {
        throw new Error("No process expected");
      },
    },
    context: async () => ({
      projectDir: directory,
      config: await config.configuration.resolveConfig!(
        "conv_args",
        config.storage.conversations.getContext("conv_args")!,
      ),
    }),
  });
  t.after(async () => {
    await service.close();
    await core.close();
    await rm(directory, { recursive: true, force: true });
  });
  /** Appends an assistant message with one edit call and returns the settled response. */
  const run = async (block: Record<string, unknown>) => {
    const turnId = createId("turn");
    const event = config.storage.events.append({
      id: createId("evt"),
      conversationId: "conv_args",
      type: "assistant_message",
      llmRepresentation: "assistant",
      turnId,
      inputId: null,
      payload: {
        content: [{ type: "toolCall", id: "toolu_1", name: "edit", ...block }],
        usage: { ...zero, totalTokens: 0, cost: zero },
        stopReason: "toolUse",
        api: "test",
        provider: "test",
        model: "test",
      } as never,
      createdAt: new Date().toISOString(),
    });
    const calls = service.createFromAssistantMessage(
      "conv_args",
      turnId,
      event,
    );
    await service.start(calls.map((call) => call.id));
    await waitUntil(() => !config.storage.toolCalls.get(calls[0].id));
    const response = config.storage.events
      .since("conv_args", 0)
      .find((e) => e.type === "tool_call_response")!;
    assert.equal(response.type, "tool_call_response");
    if (response.type !== "tool_call_response") throw new Error("unreachable");
    return {
      event,
      response,
      reason: JSON.stringify(response.payload.agentProjection),
    };
  };
  return { run, admissions: () => admissions };
}

test("unparsable provider arguments fail with the parse message and byte count", async (t) => {
  const f = await fixture(t);
  const raw = '{"path": "a.ts", "edits": [';
  const { event, response, reason } = await f.run({
    arguments: {},
    argumentsError: `Unexpected end of JSON input\n\nReceived arguments:\n${raw}`,
  });
  assert.equal(response.payload.outcome, "failed");
  assert.match(
    reason,
    new RegExp(
      `The tool arguments could not be parsed \\(${Buffer.byteLength(raw)} bytes received\\): Unexpected end of JSON input`,
    ),
  );
  assert.equal(f.admissions(), 0);
  // The raw text stays in the stored assistant event.
  const stored = JSON.stringify(
    (event.payload as { content: unknown[] }).content,
  );
  assert.ok(stored.includes("Received arguments"));
});

test("schema-invalid arguments fail with field-level errors before admission", async (t) => {
  const f = await fixture(t);
  const { response, reason } = await f.run({ arguments: {} });
  assert.equal(response.payload.outcome, "failed");
  assert.match(reason, /edit: missing required \\"path\\"/);
  assert.match(reason, /missing required \\"edits\\"/);
  assert.equal(f.admissions(), 0);
});
