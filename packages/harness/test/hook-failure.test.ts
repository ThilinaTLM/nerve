import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnyModel } from "../src/types.js";
import { AgentHarness } from "../src/harness/agent-harness.js";
import { Conversation } from "../src/harness/conversation/conversation.js";
import { InMemoryConversationStorage } from "../src/harness/conversation/memory-storage.js";
import { AgentHarnessError } from "../src/harness/errors.js";

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
  maxTokens: 1_024,
} as unknown as AnyModel;

describe("AgentHarness hook failures", () => {
  it("rethrows hook errors without synthesizing an assistant model failure", async () => {
    const storage = new InMemoryConversationStorage({
      metadata: {
        id: "conv_hook_test",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const harness = new AgentHarness({
      env: {} as never,
      conversation: new Conversation(storage),
      model,
      systemPrompt: "test",
    });
    const endedRoles: string[] = [];
    harness.subscribe((event) => {
      if (event.type === "message_end") endedRoles.push(event.message.role);
    });
    harness.on("context", async () => {
      throw new Error("host projection failed");
    });

    await assert.rejects(harness.prompt("hello"), (error: unknown) => {
      assert.ok(error instanceof AgentHarnessError);
      assert.equal(error.code, "hook");
      assert.match(error.message, /host projection failed/);
      return true;
    });
    assert.equal(endedRoles.includes("assistant"), false);
    const entries = await storage.getEntries();
    assert.equal(
      entries.some(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      ),
      false,
    );
  });
});
