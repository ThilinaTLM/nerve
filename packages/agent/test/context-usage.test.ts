import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  computeContextUsage,
  estimateContextTokens,
} from "../src/harness/compaction/compaction.js";
import type { SessionTreeEntry } from "../src/harness/session/entries.js";
import { buildSessionContext } from "../src/harness/session/session.js";
import type { AgentMessage } from "../src/types.js";

const contextWindow = 200_000;
const timestamp = "2026-01-01T00:00:00.000Z";

function usage(totalTokens: number): Usage {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function assistant(text: string, totalTokens: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: usage(totalTokens),
    stopReason: "stop",
    timestamp: Date.parse(timestamp),
  };
}

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.parse(timestamp) };
}

function messageEntry(
  id: string,
  message: AgentMessage,
  parentId: string | null = null,
): SessionTreeEntry {
  return { type: "message", id, parentId, timestamp, message };
}

function compactionEntry(
  id: string,
  firstKeptEntryId: string,
  parentId: string | null = null,
): SessionTreeEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp,
    summary: "summary",
    firstKeptEntryId,
    tokensBefore: 195_000,
  };
}

describe("context usage", () => {
  it("reports latest provider usage against the selected model context window", () => {
    const entries = [
      messageEntry("entry_1", user("hello")),
      messageEntry("entry_2", assistant("hi", 200), "entry_1"),
    ];
    const messages = buildSessionContext(entries).messages;

    assert.deepEqual(computeContextUsage(messages, entries, contextWindow), {
      tokens: 200,
      contextWindow,
      percent: (200 / contextWindow) * 100,
    });
  });

  it("reports unknown current usage immediately after compaction", () => {
    const keptUserId = "entry_3";
    const entries = [
      messageEntry("entry_1", user("first")),
      messageEntry("entry_2", assistant("response1", 180_000), "entry_1"),
      messageEntry(keptUserId, user("second"), "entry_2"),
      messageEntry("entry_4", assistant("response2", 195_000), keptUserId),
      compactionEntry("entry_5", keptUserId, "entry_4"),
      messageEntry("entry_6", user("third"), "entry_5"),
    ];
    const messages = buildSessionContext(entries).messages;

    assert.deepEqual(computeContextUsage(messages, entries, contextWindow), {
      tokens: null,
      contextWindow,
      percent: null,
    });
  });

  it("uses post-compaction assistant usage instead of stale kept usage", () => {
    const keptUserId = "entry_3";
    const entries = [
      messageEntry("entry_1", user("first")),
      messageEntry("entry_2", assistant("response1", 180_000), "entry_1"),
      messageEntry(keptUserId, user("second"), "entry_2"),
      messageEntry("entry_4", assistant("response2", 195_000), keptUserId),
      compactionEntry("entry_5", keptUserId, "entry_4"),
      messageEntry("entry_6", user("third"), "entry_5"),
      messageEntry("entry_7", assistant("response3", 25_000), "entry_6"),
    ];
    const messages = buildSessionContext(entries).messages;

    assert.deepEqual(computeContextUsage(messages, entries, contextWindow), {
      tokens: 25_000,
      contextWindow,
      percent: (25_000 / contextWindow) * 100,
    });
  });

  it("estimates trailing messages after the latest provider usage", () => {
    const messages = [assistant("baseline", 1_000), user("x".repeat(40))];

    assert.deepEqual(estimateContextTokens(messages), {
      tokens: 1_010,
      usageTokens: 1_000,
      trailingTokens: 10,
      lastUsageIndex: 0,
    });
  });
});
