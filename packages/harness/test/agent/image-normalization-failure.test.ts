import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { ImageContent } from "@earendil-works/pi-ai";
import { Agent } from "../../src/agent/agent.js";
import type {
  AgentEvent,
  AnyModel,
  StreamFn,
} from "../../src/agent/contracts/index.js";

const model = {
  id: "test-model",
  name: "Test model",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_024,
} as unknown as AnyModel;

function malformedOversizedImage(): ImageContent {
  const malformed = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(malformed);
  malformed.writeUInt32BE(190, 16);
  malformed.writeUInt32BE(8_101, 20);
  return {
    type: "image",
    data: malformed.toString("base64"),
    mimeType: "image/png",
  };
}

describe("Agent image normalization failures", () => {
  it("emits a visible terminal error and settles without calling the provider", async () => {
    let providerCalls = 0;
    const streamFn = (() => {
      providerCalls += 1;
      throw new Error("provider should not be called");
    }) as StreamFn;
    const agent = new Agent({
      initialState: { model },
      streamFn,
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
      events.push(event);
    });

    await agent.prompt("inspect", [malformedOversizedImage()]);
    await agent.waitForIdle();

    assert.equal(providerCalls, 0);
    assert.equal(agent.state.isStreaming, false);
    assert.match(
      agent.state.errorMessage ?? "",
      /Could not prepare image.*8101.*8000px/,
    );
    assert.deepEqual(
      events.slice(-4).map((event) => event.type),
      ["message_start", "message_end", "turn_end", "agent_end"],
    );
    const lastMessage = agent.state.messages.at(-1);
    assert.equal(lastMessage?.role, "assistant");
    if (lastMessage?.role === "assistant") {
      assert.equal(lastMessage.stopReason, "error");
    }
  });
});
