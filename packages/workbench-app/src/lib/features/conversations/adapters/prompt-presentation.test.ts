import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ConversationSnapshot,
  QueuedInput,
  TransferredConversationEvent,
} from "@nervekit/contracts/core";
import { promptPresentations } from "./prompt-presentation";

const time = (seconds: number) =>
  `2026-10-12T10:00:${String(seconds).padStart(2, "0")}.000Z`;
function input(id = "first", seconds = 10, sequence = 1): QueuedInput {
  return {
    inputId: id,
    conversationId: "conversation",
    acceptanceSequence: sequence,
    source: "user",
    senderConversationId: null,
    content: "Hello",
    deliveryTarget: "next_turn",
    targetExecutionId: null,
    commandPreparation: null,
    preparedText: "Hello",
    wakeWhenIdle: true,
    acceptedAt: time(seconds),
  };
}
function execution(
  transition: "started" | "completed" | "waiting" | "failed",
  seconds: number,
): TransferredConversationEvent {
  return {
    id: `event-${seconds}`,
    conversationId: "conversation",
    previousEventId: null,
    turnId: null,
    inputId: null,
    sequence: seconds,
    createdAt: time(seconds),
    type: "system_event",
    llmRepresentation: "none",
    payload:
      transition === "started"
        ? { subtype: "execution_state", transition }
        : { subtype: "execution_state", transition, executionId: "execution" },
  };
}
const snapshot = (
  queue: QueuedInput[],
  toolCalls: ConversationSnapshot["toolCalls"] = [],
) => ({ queue, toolCalls });

test("new and idle conversations show the first accepted input as starting", () => {
  assert.equal(
    promptPresentations(snapshot([input()]), []).get("first"),
    "starting",
  );
  assert.equal(
    promptPresentations(snapshot([input()]), [
      execution("started", 1),
      execution("completed", 5),
    ]).get("first"),
    "starting",
  );
});
test("a start caused by acceptance does not turn the bubble into queued", () => {
  for (const seconds of [10, 11])
    assert.equal(
      promptPresentations(snapshot([input()]), [
        execution("started", seconds),
      ]).get("first"),
      "starting",
    );
});
test("prompts accepted during existing work stay waiting even after that work ends", () => {
  for (const events of [
    [execution("started", 1)],
    [execution("started", 1), execution("waiting", 5)],
    [execution("started", 1), execution("completed", 11)],
  ]) {
    assert.equal(
      promptPresentations(snapshot([input()]), events).get("first"),
      "waiting",
    );
  }
});
test("earlier undelivered input makes additional inputs waiting", () => {
  const states = promptPresentations(
    snapshot([input("second", 10, 2), input()]),
    [],
  );
  assert.equal(states.get("first"), "starting");
  assert.equal(states.get("second"), "waiting");
});
test("a consumed earlier prompt keeps the next input waiting", () => {
  const message: TransferredConversationEvent = {
    id: "message",
    conversationId: "conversation",
    previousEventId: null,
    turnId: null,
    inputId: "first",
    sequence: 12,
    createdAt: time(12),
    type: "user_message",
    llmRepresentation: "user",
    payload: {
      text: "Hello",
      originalText: "Hello",
      source: "user",
      senderConversationId: null,
      commandPreparation: null,
    },
  };
  assert.equal(
    promptPresentations(snapshot([input("second", 10, 2)]), [
      execution("started", 11),
      message,
    ]).get("second"),
    "waiting",
  );
});
test("unresolved tool interactions keep inputs visibly waiting", () => {
  const call: ConversationSnapshot["toolCalls"][number] = {
    id: "tool",
    conversationId: "conversation",
    turnId: "turn",
    providerCallId: "provider",
    assistantEventId: "assistant",
    contentIndex: 0,
    origin: "model",
    toolName: "ask_user",
    arguments: {},
    state: "awaiting_input",
    supervision: null,
    interaction: null,
    executionClaim: null,
    updatedAt: time(11),
  };
  assert.equal(
    promptPresentations(snapshot([input()], [call]), []).get("first"),
    "waiting",
  );
});

test("command preparation alone does not mean waiting", () => {
  const prompt = input();
  prompt.preparedText = null;
  prompt.commandPreparation = {
    blocks: [
      { index: 0, command: "git status", state: "running", result: null },
    ],
  };
  assert.equal(
    promptPresentations(snapshot([prompt]), []).get("first"),
    "starting",
  );
});
test("delivery removes the pending projection and a failed previous execution permits starting", () => {
  assert.equal(promptPresentations(snapshot([]), []).size, 0);
  assert.equal(
    promptPresentations(snapshot([input()]), [
      execution("started", 1),
      execution("failed", 5),
    ]).get("first"),
    "starting",
  );
});
