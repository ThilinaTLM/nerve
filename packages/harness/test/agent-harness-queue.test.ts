import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentHarness } from "../src/harness/agent-harness.js";
import { Conversation } from "../src/harness/conversation/conversation.js";
import { InMemoryConversationStorage } from "../src/harness/conversation/memory-storage.js";
import type { InboundQueuedMessage } from "../src/harness/harness-queue-methods.js";
import type { AgentMessage, AnyModel, QueueMode } from "../src/types.js";

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

type QueueTestHarness = {
  phase: "turn";
  steerQueue: InboundQueuedMessage[];
  followUpQueue: InboundQueuedMessage[];
  drainQueuedMessages(
    queue: InboundQueuedMessage[],
    mode: QueueMode,
  ): Promise<AgentMessage[]>;
};

function createHarness(): AgentHarness {
  return new AgentHarness({
    env: {} as never,
    conversation: new Conversation(
      new InMemoryConversationStorage({
        metadata: {
          id: "conv_queue_test",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ),
    model,
    systemPrompt: "test",
  });
}

describe("AgentHarness queued message lifecycle", () => {
  it("reports prompt ids only when the queue is drained", async () => {
    const harness = createHarness();
    const internal = harness as unknown as QueueTestHarness;
    internal.phase = "turn";
    const drained: string[][] = [];
    harness.subscribe((event) => {
      if (event.type === "queue_drained") drained.push(event.messageIds);
    });

    await harness.steer("follow up", { id: "promptq_follow_up" });
    assert.deepEqual(drained, []);

    const messages = await internal.drainQueuedMessages(
      internal.steerQueue,
      "one-at-a-time",
    );
    assert.equal(messages.length, 1);
    assert.deepEqual(drained, [["promptq_follow_up"]]);
  });

  it("keeps follow-ups separate from steering until natural completion", async () => {
    const harness = createHarness();
    const internal = harness as unknown as QueueTestHarness;
    internal.phase = "turn";

    await harness.followUp("after current work", { id: "promptq_follow_up" });

    assert.equal(internal.steerQueue.length, 0);
    assert.equal(internal.followUpQueue.length, 1);
    const messages = await internal.drainQueuedMessages(
      internal.followUpQueue,
      "one-at-a-time",
    );
    assert.equal(messages.length, 1);
  });

  it("does not drain a queued prompt removed by id", async () => {
    const harness = createHarness();
    const internal = harness as unknown as QueueTestHarness;
    internal.phase = "turn";
    const drained: string[][] = [];
    harness.subscribe((event) => {
      if (event.type === "queue_drained") drained.push(event.messageIds);
    });

    await harness.steer("discard me", { id: "promptq_discard" });
    assert.equal(await harness.removeQueuedMessage("promptq_discard"), true);

    const messages = await internal.drainQueuedMessages(
      internal.steerQueue,
      "one-at-a-time",
    );
    assert.deepEqual(messages, []);
    assert.deepEqual(drained, []);
  });
});
