import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceQueuedUserEntries,
  takeQueuedMessageEntries,
} from "../../../src/harness/queue/coalescing.js";
import type { InboundQueuedMessage } from "../../../src/harness/queue/operations.js";
import { createHarnessMessage } from "../../../src/messages/messages.js";
import { createUserMessage } from "../../../src/harness/run/run-messages.js";
import type { AgentMessage } from "../../../src/agent/contracts/index.js";

function textOf(message: AgentMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  if (message.role === "harness") return message.content;
  return "";
}

function userEntry(text: string): InboundQueuedMessage {
  return {
    source: "user",
    message: createUserMessage(text),
    enqueuedAt: new Date().toISOString(),
  };
}

function harnessEntry(text: string): InboundQueuedMessage {
  return {
    id: `harness_${text}`,
    source: "harness",
    message: createHarnessMessage(
      "task_event",
      text,
      { event: "completed" },
      new Date().toISOString(),
    ),
    enqueuedAt: new Date().toISOString(),
  };
}

describe("harness queued user message coalescing", () => {
  it("drains consecutive leading user messages together in one-at-a-time mode", () => {
    const queue = [
      userEntry("first"),
      userEntry("second"),
      harnessEntry("done"),
    ];

    const drained = takeQueuedMessageEntries(queue, "one-at-a-time");
    const groups = coalesceQueuedUserEntries(drained);

    assert.equal(queue.length, 1);
    assert.equal(groups.length, 1);
    assert.equal(textOf(groups[0]?.message as AgentMessage), "first\n\nsecond");
    assert.equal(groups[0]?.entries.length, 2);
  });

  it("does not drain a harness event or following user prompts with leading user prompts", () => {
    const first = userEntry("first");
    const queue = [first, harnessEntry("done"), userEntry("second")];

    assert.deepEqual(takeQueuedMessageEntries(queue, "one-at-a-time"), [first]);
    assert.equal(queue.length, 2);
    assert.equal(textOf(queue[0]!.message), "done");
    assert.equal(textOf(queue[1]!.message), "second");
  });

  it("preserves images and the original timestamp when combining queued prompts", () => {
    const first = userEntry("first");
    const second = userEntry("second");
    const firstImage = {
      type: "image" as const,
      data: "first-image",
      mimeType: "image/png",
    };
    const secondImage = {
      type: "image" as const,
      data: "second-image",
      mimeType: "image/png",
    };
    const firstMessage = createUserMessage("first", [firstImage]);
    const secondMessage = createUserMessage("second", [secondImage]);
    firstMessage.timestamp = 123;
    secondMessage.timestamp = 456;
    first.message = firstMessage;
    second.message = secondMessage;

    const [group] = coalesceQueuedUserEntries([first, second]);
    assert.equal(group?.message.role, "user");
    if (group?.message.role !== "user") return;
    assert.equal(group.message.timestamp, 123);
    assert.deepEqual(group.message.content, [
      { type: "text", text: "first\n\nsecond" },
      firstImage,
      secondImage,
    ]);
    assert.deepEqual(group.entries, [first, second]);
  });

  it("keeps harness messages as boundaries while coalescing all drained entries", () => {
    const drained = [
      userEntry("first"),
      userEntry("second"),
      harnessEntry("done"),
      userEntry("third"),
    ];

    const groups = coalesceQueuedUserEntries(drained);

    assert.equal(groups.length, 3);
    assert.equal(textOf(groups[0]?.message as AgentMessage), "first\n\nsecond");
    assert.equal(textOf(groups[1]?.message as AgentMessage), "done");
    assert.equal(textOf(groups[2]?.message as AgentMessage), "third");
  });
});
