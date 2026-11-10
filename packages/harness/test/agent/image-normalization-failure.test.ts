import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it, mock } from "node:test";
import type { Context, ImageContent } from "@earendil-works/pi-ai";
import { Agent } from "../../src/agent/agent.js";
import type { AnyModel, StreamFn } from "../../src/agent/contracts/index.js";

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
  it("replaces an unpreparable image with a text placeholder and still calls the provider", async () => {
    mock.method(console, "error", () => undefined);
    const seen: Context[] = [];
    const streamFn = ((_model: unknown, context: Context) => {
      seen.push(context);
      throw new Error("stop after capture");
    }) as unknown as StreamFn;
    const agent = new Agent({ initialState: { model }, streamFn });

    await agent.prompt("inspect", [malformedOversizedImage()]);
    await agent.waitForIdle();
    mock.restoreAll();

    assert.equal(seen.length, 1);
    const user = seen[0].messages[0];
    assert.equal(user.role, "user");
    const content = user.content as Array<{ type: string; text?: string }>;
    assert.equal(
      content.some((block) => block.type === "image"),
      false,
    );
    assert.ok(
      content.some((block) =>
        /\[Image omitted: could not be prepared/.test(block.text ?? ""),
      ),
    );
    // The original stored message keeps its image.
    const stored = agent.state.messages[0] as { content: unknown[] };
    assert.ok(
      stored.content.some(
        (block) => (block as { type: string }).type === "image",
      ),
    );
  });
});
