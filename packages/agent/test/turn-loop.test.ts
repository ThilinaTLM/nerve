import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Message,
  type Usage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { convertToLlm, createHarnessMessage } from "../src/harness/messages.js";
import { runAgentLoop } from "../src/runtime/loop/agent-loop.js";
import type {
  AgentContext,
  AgentTool,
  AnyModel,
  StreamFn,
} from "../src/types.js";

const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model = {
  id: "test-model",
  name: "Test model",
  api: "anthropic",
  provider: "anthropic",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1024,
} as unknown as AnyModel;

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic",
    provider: "anthropic",
    model: "test-model",
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function streamMessage(message: AssistantMessage): ReturnType<StreamFn> {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
  return stream;
}

function textOf(message: Message): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  if (message.role === "toolResult") {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

describe("agent loop steering queue", () => {
  it("drains harness messages before stop and before the next LLM request", async () => {
    const providerContexts: Context[] = [];
    const streamFn: StreamFn = (_model, context, _options) => {
      providerContexts.push(context);
      return streamMessage(assistant([{ type: "text", text: "ok" }]));
    };
    let steeringCalls = 0;
    const harnessMessage = createHarnessMessage(
      "task_event",
      "Task typecheck (task_123) finished: failed; cursor=7.",
      { taskId: "task_123", event: "failed", status: "failed" },
      new Date().toISOString(),
    );

    await runAgentLoop(
      [{ role: "user", content: "start", timestamp: Date.now() }],
      { systemPrompt: "", messages: [] },
      {
        model,
        convertToLlm,
        getSteeringMessages: async () => {
          steeringCalls += 1;
          return steeringCalls === 2 ? [harnessMessage] : [];
        },
        shouldStopAfterTurn: () => true,
      },
      async () => undefined,
      undefined,
      streamFn,
    );

    assert.equal(providerContexts.length, 2);
    const secondRequestMessages = providerContexts[1]?.messages ?? [];
    assert.match(
      textOf(secondRequestMessages.at(-1) as Message),
      /<background_task_update>[\s\S]*not a user request[\s\S]*task_123/,
    );
  });

  it("inserts harness messages after assistant tool results, not before", async () => {
    const providerContexts: Context[] = [];
    let requestCount = 0;
    const streamFn: StreamFn = (_model, context, _options) => {
      providerContexts.push(context);
      requestCount += 1;
      if (requestCount === 1) {
        return streamMessage(
          assistant(
            [
              {
                type: "toolCall",
                id: "call_1",
                name: "noop",
                arguments: {},
              },
            ],
            "toolUse",
          ),
        );
      }
      return streamMessage(assistant([{ type: "text", text: "done" }]));
    };
    let steeringCalls = 0;
    const harnessMessage = createHarnessMessage(
      "task_event",
      "Task tests (task_456) finished: completed; cursor=3.",
      { taskId: "task_456", event: "completed", status: "completed" },
      new Date().toISOString(),
    );
    const noopTool: AgentTool = {
      name: "noop",
      label: "noop",
      description: "No-op tool",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => ({
        content: [{ type: "text", text: "tool result" }],
        details: {},
      }),
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [noopTool],
    };

    await runAgentLoop(
      [{ role: "user", content: "start", timestamp: Date.now() }],
      context,
      {
        model,
        convertToLlm,
        getSteeringMessages: async () => {
          steeringCalls += 1;
          return steeringCalls === 2 ? [harnessMessage] : [];
        },
      },
      async () => undefined,
      undefined,
      streamFn,
    );

    assert.equal(providerContexts.length, 2);
    const roles = providerContexts[1]?.messages.map((message) => message.role);
    assert.deepEqual(roles, ["user", "assistant", "toolResult", "user"]);
    assert.equal(
      textOf(providerContexts[1]?.messages[2] as Message),
      "tool result",
    );
    assert.match(
      textOf(providerContexts[1]?.messages[3] as Message),
      /<background_task_update>[\s\S]*task_456/,
    );
  });
});
