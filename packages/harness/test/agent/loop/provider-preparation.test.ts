import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Message,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { convertToLlm } from "../../../src/messages/messages.js";
import {
  runAgentLoop,
  runAgentLoopContinue,
} from "../../../src/agent/loop/agent-loop.js";
import type {
  AgentTool,
  AnyModel,
  StreamFn,
} from "../../../src/agent/contracts/index.js";

const usage = {
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

describe("pre-provider preparation refresh", () => {
  it("rebuilds one invocation without replaying emitted inputs or changing its tool authority", async () => {
    const events: string[] = [];
    const executed: string[] = [];
    const oldTool: AgentTool = {
      name: "read",
      label: "read",
      description: "read",
      parameters: Type.Object({}),
      execute: async () => {
        executed.push("stale");
        return { content: [], details: {} };
      },
    };
    const freshTool: AgentTool = {
      ...oldTool,
      execute: async () => {
        executed.push("originating");
        return {
          content: [{ type: "text", text: "originating result" }],
          details: {},
        };
      },
    };
    const laterTool: AgentTool = {
      ...oldTool,
      execute: async () => {
        executed.push("later");
        return { content: [], details: {} };
      },
    };
    let preparations = 0;
    let requests = 0;
    const nextModel = {
      ...model,
      id: "fresh-model",
      provider: "fresh-provider",
    };
    const storedInput = {
      role: "user",
      content: "original",
      timestamp: 1,
    } as const;
    const steering = {
      role: "user",
      content: "steering",
      timestamp: 2,
    } as const;
    const messages = await runAgentLoop(
      [storedInput],
      { systemPrompt: "stale", messages: [], tools: [oldTool] },
      {
        model,
        convertToLlm,
        getSteeringMessages: async () => (preparations === 0 ? [steering] : []),
        prepareProviderDispatch: async () => {
          if (++preparations !== 1) return { kind: "ready" };
          return {
            kind: "refresh",
            update: {
              context: {
                systemPrompt: "fresh",
                messages: [storedInput, steering],
                tools: [freshTool],
              },
              model: nextModel,
              thinkingLevel: "high",
            },
          };
        },
        prepareNextTurn: async ({ context, hasMoreToolCalls }) =>
          hasMoreToolCalls
            ? {
                context: { ...context, tools: [laterTool] },
              }
            : undefined,
      },
      (event) => {
        events.push(
          event.type === "message_end"
            ? `message_end:${event.message.role}`
            : event.type,
        );
      },
      undefined,
      (requestModel, context, options) => {
        requests++;
        assert.equal(requestModel, nextModel);
        assert.equal(context.systemPrompt, "fresh");
        assert.equal(options?.reasoning, "high");
        if (requests === 1) {
          assert.deepEqual(context.messages.map(textOf), [
            "original",
            "steering",
          ]);
          assert.equal(context.tools?.[0], freshTool);
          return streamMessage(
            assistant(
              [{ type: "toolCall", id: "call", name: "read", arguments: {} }],
              "toolUse",
            ),
          );
        }
        assert.equal(context.tools?.[0], laterTool);
        return streamMessage(assistant([{ type: "text", text: "finished" }]));
      },
    );
    assert.deepEqual(executed, ["originating"]);
    assert.equal(requests, 2);
    assert.equal(preparations, 3);
    assert.equal(events.filter((event) => event === "turn_start").length, 2);
    assert.equal(
      events.filter((event) => event === "message_end:user").length,
      2,
    );
    assert.equal(
      events.filter((event) => event === "message_end:assistant").length,
      2,
    );
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "user", "assistant", "toolResult", "assistant"],
    );
  });

  it("bounds a perpetually refreshing hook without ever acquiring a stream", async () => {
    let requests = 0;
    let preparations = 0;
    await assert.rejects(
      runAgentLoopContinue(
        {
          systemPrompt: "",
          messages: [{ role: "user", content: "start", timestamp: 1 }],
        },
        {
          model,
          convertToLlm,
          prepareProviderDispatch: async () => {
            preparations++;
            return { kind: "refresh", update: {} };
          },
        },
        () => {},
        undefined,
        () => {
          requests++;
          return streamMessage(assistant([]));
        },
      ),
      /exceeded refresh limit/,
    );
    assert.equal(preparations, 65);
    assert.equal(requests, 0);
  });
});
