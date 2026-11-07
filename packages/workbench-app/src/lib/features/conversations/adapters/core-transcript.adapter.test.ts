import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ConversationSnapshot,
  TransferredConversationEvent,
} from "@nervekit/contracts/core";

// The adapter only reads the catalog; no reactive runtime is needed here.
Object.defineProperty(globalThis, "$state", {
  configurable: true,
  value: <T>(value: T): T => value,
});
const { conversationTranscript, committedTranscript, liveTranscript } =
  await import("./core-transcript.adapter");
Reflect.deleteProperty(globalThis, "$state");

const createdAt = "2026-10-24T10:00:00.000Z";
const snapshot = {
  conversation: {
    id: "conversation",
    projectId: "project",
    status: "idle",
    headEventId: null,
    updatedAt: createdAt,
  },
  config: { workingDirectory: "/project" },
  toolCalls: [],
  queue: [],
  asyncBash: [],
  compaction: null,
} as unknown as ConversationSnapshot;

function notice(
  id: string,
  producer: string,
  subtype: "notification" | "user_intervention" = "notification",
): TransferredConversationEvent {
  return {
    id,
    conversationId: "conversation",
    previousEventId: null,
    turnId: null,
    inputId: null,
    sequence: 1,
    createdAt,
    type: "system_event",
    llmRepresentation: "none",
    payload: { subtype, producer, text: id },
  };
}

function transcript(events: TransferredConversationEvent[]) {
  return conversationTranscript({
    snapshot,
    events,
    liveBlocks: [],
    toolOutput: {},
  });
}

test("historical profile receipts are hidden before transcript row accounting", () => {
  const events = ["accepted", "applied", "rejected"].map((phase) =>
    notice(phase, `agent-profile:${phase}`),
  );
  events.push(notice("ordinary", "background-task:completed"));
  const result = transcript(events);
  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    ["ordinary"],
  );
  assert.equal(result.entries[0].kind, "message");
  assert.equal(events.length, 4, "stored history is not rewritten");
});

test("unrelated notifications and actual command results remain visible", () => {
  const events = [
    notice("notification", "agent-profile"),
    notice("other", "other:agent-profile:applied"),
    notice("command", "agent-profile:command", "user_intervention"),
  ];
  const result = transcript(events);
  assert.deepEqual(
    result.entries.map(({ id, kind, text }) => ({ id, kind, text })),
    events.map(({ id }) => ({ id, kind: "message", text: id })),
  );
});

test("unchanged rows and tool calls keep identity across a delta", () => {
  const user = notice("user", "background-task:completed");
  const response = {
    id: "resp",
    conversationId: "conversation",
    previousEventId: null,
    turnId: "turn",
    inputId: null,
    sequence: 2,
    createdAt,
    type: "tool_call_response",
    llmRepresentation: "none",
    payload: {
      toolCallId: "tool-1",
      toolName: "bash",
      outcome: "completed",
      startedAt: createdAt,
      userProjection: { argsPreview: { command: "ls" }, resultPreview: "ok" },
    },
  } as unknown as TransferredConversationEvent;
  const first = transcript([user, response]);
  const next = transcript([user, response, notice("later", "other:x")]);
  assert.equal(next.entries[0], first.entries[0]);
  assert.equal(next.toolCalls[0], first.toolCalls[0]);
});

test("live blocks never feed the committed projection", () => {
  const user = notice("user", "background-task:completed");
  const committed = committedTranscript({ snapshot, events: [user] });
  const running = {
    ...committed.run,
    running: true,
    status: "running" as const,
  };
  const live = (text: string) =>
    liveTranscript({
      run: running,
      queuedPrompts: committed.queuedPrompts,
      liveBlocks: [{ turnId: "turn", contentIndex: 0, text, thinking: "" }],
      toolOutput: { tool: text },
    });
  assert.equal(live("a")?.turns[0].messages[0].blocks[0].kind, "text");
  assert.equal(live("ab")?.toolOutputsByToolCallId.tool.text, "ab");
  assert.equal(live("a")?.runId, "turn", "live turn supplies the run fallback");
  assert.equal(
    liveTranscript({
      run: { ...running, running: false },
      queuedPrompts: [],
      liveBlocks: [],
      toolOutput: {},
    }),
    undefined,
  );
});
