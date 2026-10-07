import assert from "node:assert/strict";
import test from "node:test";
import { AgentHarness } from "../../../src/harness/agent-harness.js";
import { Conversation } from "../../../src/conversation/conversation.js";
import { InMemoryConversationStorage } from "../../../src/conversation/adapters/in-memory-storage.js";
import { getRegisteredModels } from "../../../src/models/model-registry.js";
import type { AgentMessage } from "../../../src/agent/contracts/index.js";

test("switching provider reconstructs compatible historical tool IDs and discards foreign thinking signatures", async () => {
  const oldModel = getRegisteredModels("openai")[0]!;
  const nextModel = getRegisteredModels("anthropic")[0]!;
  const conversation = new Conversation(new InMemoryConversationStorage());
  const oldCallId = "call_old|provider_specific_id";
  const history: AgentMessage[] = [
    { role: "user", content: "read a file", timestamp: 1 },
    {
      role: "assistant",
      api: oldModel.api,
      provider: oldModel.provider,
      model: oldModel.id,
      timestamp: 2,
      stopReason: "toolUse",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content: [
        {
          type: "thinking",
          thinking: "historical reasoning",
          thinkingSignature: "foreign-openai-signature",
        },
        {
          type: "toolCall",
          id: oldCallId,
          name: "read",
          arguments: { path: "file.txt" },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: oldCallId,
      toolName: "read",
      content: [{ type: "text", text: "historical file result" }],
      isError: false,
      timestamp: 3,
    },
    { role: "user", content: "continue using the new provider", timestamp: 4 },
  ];
  for (const message of history) await conversation.appendMessage(message);
  let payload: unknown;
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body =
      options?.body ?? (url instanceof Request ? await url.clone().text() : "");
    payload = JSON.parse(String(body));
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "offline test boundary",
        },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const harness = new AgentHarness({
      model: oldModel,
      conversation,
      env: {} as never,
      streamOptions: { maxRetries: 0 },
      getApiKeyAndHeaders: async () => ({ apiKey: "unit-test-placeholder" }),
      prepareTurn: async () => ({
        model: nextModel,
        thinkingLevel: "off",
        tools: [],
        activeToolNames: [],
        resources: {},
        systemPrompt: "new provider snapshot",
      }),
    });
    await harness.continue();
    assert.ok(
      payload,
      "provider payload was produced without a network request",
    );
    const serialized = JSON.stringify(payload);
    assert.match(serialized, /historical file result/);
    assert.match(serialized, /continue using the new provider/);
    assert.match(serialized, /new provider snapshot/);
    assert.doesNotMatch(serialized, /foreign-openai-signature/);
    assert.doesNotMatch(serialized, /call_old\|provider_specific_id/);
    const messages = (
      payload as {
        messages: Array<{
          content: Array<{ type: string; id?: string; tool_use_id?: string }>;
        }>;
      }
    ).messages;
    const use = messages
      .flatMap((message) => message.content)
      .find((block) => block.type === "tool_use");
    const result = messages
      .flatMap((message) => message.content)
      .find((block) => block.type === "tool_result");
    assert.ok(use?.id);
    assert.equal(result?.tool_use_id, use.id);
    const original = (await conversation.buildContext()).messages.find(
      (message) =>
        message.role === "assistant" && message.provider === oldModel.provider,
    );
    assert.equal(
      original?.role === "assistant"
        ? original.content.find((block) => block.type === "toolCall")?.id
        : undefined,
      oldCallId,
    );
  } finally {
    globalThis.fetch = fetch;
  }
});
