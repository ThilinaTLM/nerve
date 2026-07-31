import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import type { AnyModel } from "../../src/agent/types/index.js";
import { streamProxy } from "../../src/transport/proxy.js";

const usage: Usage = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model = {
  id: "test-model",
  name: "Test model",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1024,
} as unknown as AnyModel;

const encoder = new TextEncoder();

function sse(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n`);
}

describe("proxy streaming", () => {
  it("keeps partial messages pending until a terminal event arrives", async () => {
    const originalFetch = globalThis.fetch;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        controller.enqueue(sse({ type: "start" }));
      },
    });
    globalThis.fetch = async () => new Response(body, { status: 200 });

    try {
      const stream = streamProxy(
        model,
        { messages: [] },
        { authToken: "test-token", proxyUrl: "https://proxy.test" },
      );
      const iterator = stream[Symbol.asyncIterator]();

      const start = await iterator.next();
      assert.equal(start.done, false);
      assert.equal(start.value?.type, "start");
      if (start.value?.type === "start") {
        assert.equal(start.value.partial.stopReason, "pending");
      }

      controller.enqueue(sse({ type: "done", reason: "stop", usage }));
      controller.close();

      const done = await iterator.next();
      assert.equal(done.done, false);
      assert.equal(done.value?.type, "done");
      if (done.value?.type === "done") {
        assert.equal(done.value.message.stopReason, "stop");
      }
      assert.equal((await iterator.next()).done, true);
      assert.equal((await stream.result()).stopReason, "stop");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
