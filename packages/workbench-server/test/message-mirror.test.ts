import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord, ConversationEntry } from "@nervekit/contracts";
import type { JsonlConversationStorage } from "@nervekit/host-runtime/harness";
import type { EventBus } from "../src/infrastructure/events/index.js";
import type { RuntimeState } from "../src/runtime/runtime-state.js";
import {
  type AppendEntryInput,
  AssistantEntryMetaQueue,
  type AssistantMessageMeta,
  MessageMirror,
} from "../src/domains/agents/run/message-mirror.js";

const agent = {
  id: "agent_test",
  conversationId: "conv_test",
} as AgentRecord;

function assistantStorageEntry(id: string, text: string) {
  return {
    type: "message" as const,
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function toolResultStorageEntry(id: string) {
  return {
    type: "message" as const,
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text: "ok" }],
    },
  };
}

function createMirror(storageEntries: unknown[]) {
  const appended: AppendEntryInput[] = [];
  const mirror = new MessageMirror({
    state: {
      getConversationEntries: () => [],
      conversations: new Map(),
    } as unknown as RuntimeState,
    appendEntry: async (input) => {
      appended.push(input);
      return {
        id: input.id ?? `entry_${appended.length}`,
        conversationId: input.conversationId,
        role: input.role,
        kind: input.kind ?? "message",
        text: input.text,
        turnId: input.turnId,
        liveMessageId: input.liveMessageId,
        messageOrdinal: input.messageOrdinal,
        createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
      } as ConversationEntry;
    },
    updateConversation: async () => {},
    events: { publish: async () => {} } as unknown as EventBus,
  });
  const storage = {
    getEntries: async () => storageEntries,
  } as unknown as JsonlConversationStorage;
  return { mirror, storage, appended };
}

describe("AssistantEntryMetaQueue", () => {
  it("queues each ended assistant message exactly once, in order", () => {
    const queue = new AssistantEntryMetaQueue();
    queue.onMessageStarted({
      turnId: "turn_1",
      liveMessageId: "msg_1",
      messageOrdinal: 0,
    });
    queue.onMessageEnded("assistant");
    // Repeated / non-assistant message_end events queue nothing.
    queue.onMessageEnded("assistant");
    queue.onMessageEnded("toolResult");
    queue.onMessageStarted({
      turnId: "turn_1",
      liveMessageId: "msg_2",
      messageOrdinal: 1,
    });
    queue.onMessageEnded("assistant");

    assert.deepEqual(
      queue.queue.map((meta) => meta.liveMessageId),
      ["msg_1", "msg_2"],
    );
  });
});

describe("MessageMirror assistant message correlation", () => {
  it("assigns FIFO metas to assistant entries within one batch", async () => {
    const { mirror, storage, appended } = createMirror([
      assistantStorageEntry("entry_a1", "first answer"),
      toolResultStorageEntry("entry_t1"),
      assistantStorageEntry("entry_a2", "second answer"),
    ]);
    const metaQueue: AssistantMessageMeta[] = [
      { turnId: "turn_1", liveMessageId: "msg_1", messageOrdinal: 0 },
      { turnId: "turn_1", liveMessageId: "msg_2", messageOrdinal: 1 },
    ];

    const mirrored = await mirror.mirrorNewHarnessEntries(
      agent,
      storage,
      new Set(),
      { runId: "run_1", turnId: "turn_1", assistantMessageMeta: metaQueue },
    );

    assert.equal(mirrored.length, 3);
    const first = appended.find((entry) => entry.id === "entry_a1");
    assert.equal(first?.liveMessageId, "msg_1");
    assert.equal(first?.messageOrdinal, 0);
    assert.equal(first?.turnId, "turn_1");
    const second = appended.find((entry) => entry.id === "entry_a2");
    assert.equal(second?.liveMessageId, "msg_2");
    assert.equal(second?.messageOrdinal, 1);
    const toolResult = appended.find((entry) => entry.id === "entry_t1");
    assert.equal(toolResult?.liveMessageId, undefined);
    assert.equal(toolResult?.messageOrdinal, undefined);
    assert.equal(toolResult?.turnId, "turn_1");
    assert.equal(metaQueue.length, 0);
  });

  it("keeps unconsumed metas for assistant entries that surface later", async () => {
    const metaQueue: AssistantMessageMeta[] = [
      { turnId: "turn_1", liveMessageId: "msg_1", messageOrdinal: 0 },
    ];
    const known = new Set<string>();

    // First batch: only the tool result is visible in storage.
    const first = createMirror([toolResultStorageEntry("entry_t1")]);
    await first.mirror.mirrorNewHarnessEntries(agent, first.storage, known, {
      runId: "run_1",
      turnId: "turn_1",
      assistantMessageMeta: metaQueue,
    });
    assert.equal(metaQueue.length, 1);

    // Second batch: the assistant entry flushed late and consumes its meta.
    const second = createMirror([
      toolResultStorageEntry("entry_t1"),
      assistantStorageEntry("entry_a1", "late answer"),
    ]);
    await second.mirror.mirrorNewHarnessEntries(agent, second.storage, known, {
      runId: "run_1",
      turnId: "turn_2",
      assistantMessageMeta: metaQueue,
    });
    const late = second.appended.find((entry) => entry.id === "entry_a1");
    assert.equal(late?.liveMessageId, "msg_1");
    assert.equal(late?.messageOrdinal, 0);
    assert.equal(late?.turnId, "turn_1");
    assert.equal(metaQueue.length, 0);
  });
});
