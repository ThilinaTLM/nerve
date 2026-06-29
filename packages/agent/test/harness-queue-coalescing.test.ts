import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceQueuedUserEntries,
  takeQueuedMessageEntries,
} from "../src/harness/harness-queue-coalescing.js";
import type { InboundQueuedMessage } from "../src/harness/harness-queue-methods.js";
import { createHarnessMessage } from "../src/harness/messages.js";
import { createUserMessage } from "../src/harness/run/messages.js";
import type { AgentMessage } from "../src/types.js";

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
