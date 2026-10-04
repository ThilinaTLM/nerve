import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactHarnessConversation } from "../../src/harness/maintenance/operations.js";
import { assistant, entry, user, validSummary } from "./compaction-fixtures.js";
import type { ConversationTreeEntry } from "../../src/conversation/entries.js";

function harness(
  branch: ConversationTreeEntry[],
  firstKeptEntryId: string,
  summary: string,
) {
  let appends = 0;
  let phase = "idle";
  let details: unknown;
  const context = {
    getPhase: () => phase,
    setPhase: (next: string) => {
      phase = next;
    },
    getModel: () => ({ maxTokens: 16_384, contextWindow: 128_000 }),
    getThinkingLevel: () => "off",
    getApiKeyAndHeaders: async () => ({ apiKey: "" }),
    emitHook: async () => ({
      compaction: { summary, firstKeptEntryId, tokensBefore: 100_000 },
    }),
    emitOwn: async () => undefined,
    conversation: {
      getBranch: async () => branch,
      appendCompaction: async (
        _summary: string,
        _boundary: string,
        _before: number,
        data: unknown,
      ) => {
        appends++;
        details = data;
        return "checkpoint";
      },
      getEntry: async () => undefined,
    },
  };
  return {
    compact: () => compactHarnessConversation(context as never),
    appends: () => appends,
    phase: () => phase,
    details: () => details,
  };
}

describe("direct harness compaction safety", () => {
  it("validates hook boundaries against pending tool groups before appending", async () => {
    const call = assistant(100);
    call.content.push({
      type: "toolCall",
      id: "pending",
      name: "read",
      arguments: {},
    });
    const fixture = harness(
      [
        entry("old", user("x".repeat(100_000))),
        entry("call", call),
        entry("notice", {
          role: "toolResult",
          toolCallId: "pending",
          toolName: "read",
          content: [{ type: "text", text: "result" }],
          isError: false,
          timestamp: 0,
        }),
      ],
      "notice",
      validSummary,
    );
    await assert.rejects(fixture.compact(), /splits/);
    assert.equal(fixture.appends(), 0);
    assert.equal(fixture.phase(), "idle");
  });
  it("validates hook summary shape and persists accounting on valid results", async () => {
    const branch = [
      entry("old", user("x".repeat(100_000))),
      entry("recent", user("continue")),
    ];
    const invalid = harness(branch, "recent", "missing sections");
    await assert.rejects(invalid.compact(), /Invalid checkpoint/);
    assert.equal(invalid.appends(), 0);
    const valid = harness(branch, "recent", validSummary);
    await valid.compact();
    assert.equal(valid.appends(), 1);
    assert.ok((valid.details() as { tokensAfter: number }).tokensAfter < 1_000);
    assert.equal(valid.phase(), "idle");
  });
});
