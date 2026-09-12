import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type ImageContent,
  type Message,
  type Usage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  convertToLlm,
  createHarnessMessage,
} from "../../../src/messages/messages.js";
import {
  runAgentLoop,
  runAgentLoopContinue,
} from "../../../src/agent/loop/agent-loop.js";
import type {
  AgentContext,
  AgentTool,
  AnyModel,
  StreamFn,
} from "../../../src/agent/contracts/index.js";

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

describe("agent loop image normalization", () => {
  it("does not invoke the provider when an oversized image cannot be normalized", async () => {
    const malformed = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
      malformed,
    );
    malformed.writeUInt32BE(190, 16);
    malformed.writeUInt32BE(8_101, 20);
    const image: ImageContent = {
      type: "image",
      data: malformed.toString("base64"),
      mimeType: "image/png",
    };
    let providerCalls = 0;
    const streamFn: StreamFn = () => {
      providerCalls += 1;
      return streamMessage(assistant([{ type: "text", text: "unexpected" }]));
    };

    await assert.rejects(
      runAgentLoop(
        [{ role: "user", content: [image], timestamp: Date.now() }],
        { systemPrompt: "", messages: [] },
        {
          model,
          convertToLlm,
          getSteeringMessages: async () => [],
          getFollowUpMessages: async () => [],
        },
        async () => undefined,
        undefined,
        streamFn,
      ),
      /Could not prepare image.*8101.*8000px/,
    );
    assert.equal(providerCalls, 0);
  });
});

describe("agent loop follow-up queue", () => {
  it("runs a follow-up only after a response would otherwise finish", async () => {
    const providerContexts: Context[] = [];
    let providerCalls = 0;
    let followUpCalls = 0;
    const streamFn: StreamFn = (_model, context) => {
      providerContexts.push(context);
      providerCalls += 1;
      return streamMessage(
        assistant([{ type: "text", text: `response ${providerCalls}` }]),
      );
    };

    await runAgentLoop(
      [{ role: "user", content: "start", timestamp: Date.now() }],
      { systemPrompt: "", messages: [] },
      {
        model,
        convertToLlm,
        getSteeringMessages: async () => [],
        getFollowUpMessages: async () => {
          followUpCalls += 1;
          return followUpCalls === 1
            ? [
                {
                  role: "user",
                  content: "continue from checkpoint",
                  timestamp: Date.now(),
                },
              ]
            : [];
        },
      },
      async () => undefined,
      undefined,
      streamFn,
    );

    assert.equal(providerCalls, 2);
    assert.equal(followUpCalls, 2);
    assert.match(
      textOf(providerContexts[1]?.messages.at(-1) as Message),
      /continue from checkpoint/,
    );
  });
});

describe("agent loop interruption", () => {
  it("preserves forced steering until a complete tool batch can continue", async () => {
    const providerContexts: Context[] = [];
    let providerCalls = 0;
    const streamFn: StreamFn = (_model, context) => {
      providerContexts.push(context);
      providerCalls += 1;
      if (providerCalls === 1) {
        return streamMessage(
          assistant(
            [
              {
                type: "toolCall",
                id: "call_active",
                name: "interrupting-tool",
                arguments: {},
              },
              {
                type: "toolCall",
                id: "call_cancelled",
                name: "interrupting-tool",
                arguments: {},
              },
            ],
            "toolUse",
          ),
        );
      }
      return streamMessage(
        assistant([{ type: "text", text: "continued after force push" }]),
      );
    };

    const interruptedTurn = new AbortController();
    let toolExecutions = 0;
    const interruptingTool: AgentTool = {
      name: "interrupting-tool",
      label: "interrupting-tool",
      description: "Interrupt the active sequential tool batch",
      parameters: Type.Object({}, { additionalProperties: false }),
      executionMode: "sequential",
      execute: async () => {
        toolExecutions += 1;
        interruptedTurn.abort();
        throw new Error("Command aborted.");
      },
    };
    const forcedPrompt = {
      role: "user" as const,
      content: "forced follow-up",
      timestamp: Date.now(),
    };
    const steeringQueue = [forcedPrompt];
    let steeringPolls = 0;
    const getSteeringMessages = async () => {
      steeringPolls += 1;
      return steeringPolls === 1 ? [] : steeringQueue.splice(0);
    };

    const interruptedMessages = await runAgentLoop(
      [{ role: "user", content: "start", timestamp: Date.now() }],
      { systemPrompt: "", messages: [], tools: [interruptingTool] },
      {
        model,
        convertToLlm,
        getSteeringMessages,
      },
      async () => undefined,
      interruptedTurn.signal,
      streamFn,
    );

    assert.equal(providerCalls, 1);
    assert.equal(toolExecutions, 1);
    assert.equal(steeringPolls, 1);
    assert.equal(steeringQueue.length, 1);
    assert.deepEqual(
      interruptedMessages.map((message) => message.role),
      ["user", "assistant", "toolResult", "toolResult"],
    );
    const toolResults = interruptedMessages.filter(
      (message) => message.role === "toolResult",
    );
    assert.deepEqual(
      toolResults.map((message) => message.toolCallId),
      ["call_active", "call_cancelled"],
    );
    assert.match(textOf(toolResults[1] as Message), /Operation aborted/);

    const continuation = new AbortController();
    const continuedMessages = await runAgentLoopContinue(
      {
        systemPrompt: "",
        messages: interruptedMessages,
        tools: [interruptingTool],
      },
      {
        model,
        convertToLlm,
        getSteeringMessages,
      },
      async () => undefined,
      continuation.signal,
      streamFn,
    );

    assert.equal(providerCalls, 2);
    assert.equal(steeringPolls, 3);
    assert.equal(steeringQueue.length, 0);
    assert.deepEqual(
      providerContexts[1]?.messages.map((message) => message.role),
      ["user", "assistant", "toolResult", "toolResult", "user"],
    );
    assert.equal(
      textOf(providerContexts[1]?.messages.at(-1) as Message),
      "forced follow-up",
    );
    assert.equal(
      textOf(continuedMessages.at(-1) as Message),
      "continued after force push",
    );
  });
});

describe("agent loop steering queue", () => {
  it("drains harness messages before stop and before the next LLM request", async () => {
    const providerContexts: Context[] = [];
    const streamFn: StreamFn = (_model, context) => {
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
    const streamFn: StreamFn = (_model, context) => {
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

  it("uses prepareNextTurn model and thinking for the next provider request", async () => {
    const modelA = { ...model, id: "model-a", name: "Model A" };
    const modelB = { ...model, id: "model-b", name: "Model B" };
    const providerRequests: Array<{
      model: AnyModel;
      reasoning?: unknown;
    }> = [];
    const ordering: string[] = [];
    let requestCount = 0;
    const streamFn: StreamFn = (requestModel, _context, options) => {
      ordering.push(`provider:${requestCount + 1}`);
      providerRequests.push({
        model: requestModel as AnyModel,
        reasoning: options.reasoning,
      });
      requestCount += 1;
      if (requestCount === 1) {
        return streamMessage(
          assistant(
            [
              {
                type: "toolCall",
                id: "call_prepare_next_turn",
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

    await runAgentLoop(
      [{ role: "user", content: "start", timestamp: Date.now() }],
      { systemPrompt: "", messages: [], tools: [noopTool] },
      {
        model: modelA,
        convertToLlm,
        prepareNextTurn: async () => {
          ordering.push("iteration-boundary");
          return {
            model: modelB,
            thinkingLevel: "high",
          };
        },
      },
      async () => undefined,
      undefined,
      streamFn,
    );

    assert.equal(providerRequests.length, 2);
    assert.deepEqual(ordering.slice(0, 3), [
      "provider:1",
      "iteration-boundary",
      "provider:2",
    ]);
    assert.equal(providerRequests[0]?.model.id, "model-a");
    assert.equal(providerRequests[0]?.reasoning, undefined);
    assert.equal(providerRequests[1]?.model.id, "model-b");
    assert.equal(providerRequests[1]?.reasoning, "high");
  });
});

describe("agent loop tool concurrency", () => {
  it("bounds a parallel tool batch while preserving progress", async () => {
    let providerCalls = 0;
    const streamFn: StreamFn = () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return streamMessage(
          assistant(
            Array.from({ length: 5 }, (_, index) => ({
              type: "toolCall" as const,
              id: `call_${index}`,
              name: "blocking-tool",
              arguments: {},
            })),
            "toolUse",
          ),
        );
      }
      return streamMessage(assistant([{ type: "text", text: "done" }]));
    };
    let active = 0;
    let maximumActive = 0;
    let executions = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstPairStarted!: () => void;
    const firstPair = new Promise<void>((resolve) => {
      firstPairStarted = resolve;
    });
    const tool: AgentTool = {
      name: "blocking-tool",
      label: "blocking-tool",
      description: "Concurrency test tool",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        executions += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (active === 2) firstPairStarted();
        await blocked;
        active -= 1;
        return {
          content: [{ type: "text", text: "tool result" }],
          details: {},
        };
      },
    };

    const running = runAgentLoop(
      [{ role: "user", content: "start", timestamp: Date.now() }],
      { systemPrompt: "", messages: [], tools: [tool] },
      { model, convertToLlm, maxParallelToolCalls: 2 },
      async () => undefined,
      undefined,
      streamFn,
    );
    await firstPair;
    assert.equal(executions, 2);
    assert.equal(maximumActive, 2);
    release();
    await running;
    assert.equal(executions, 5);
    assert.equal(maximumActive, 2);
  });
});
