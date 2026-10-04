import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import { buildConversationContext } from "@nervekit/harness/conversation";
import { estimateRetainedContextTokens } from "@nervekit/harness/compaction";
import { compactionAccountingSchema } from "@nervekit/contracts/conversations";
import {
  CompactionService,
  type CompactionSummarizer,
} from "../../../src/domains/conversations/operations/compaction-service.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const summary = `## Goal
Complete the feature.
## Requirements and Constraints
- Preserve API behavior.
## Work Completed
- [x] Inspected code.
## Work Remaining
- [ ] Validate edits.
## Key Decisions
- Keep behavior.
## Current Working State
- Tests have not passed.
## Continuation Plan
1. Run tests.
## Critical References
- src/feature.ts`;
function setup(
  branch: ConversationTreeEntry[],
  summarizer?: CompactionSummarizer,
) {
  let appends = 0;
  const storage = {
    getLeafId: async () => branch.at(-1)?.id ?? null,
    getPathToRoot: async () => branch,
    appendEntry: async (entry: ConversationTreeEntry) => {
      branch.push(entry);
    },
  };
  const events: string[] = [];
  const service = new CompactionService(
    () => ({ id: "conv_test", projectId: "proj_test" }) as never,
    () => ({ id: "proj_test", dir: "/tmp" }) as never,
    async (input) => {
      appends++;
      return {
        ...input,
        id: "entry_new_checkpoint",
        createdAt: timestamp,
      } as never;
    },
    { openStorage: async () => storage } as never,
    async () => undefined,
    {
      publish: async (type: string) => {
        events.push(type);
      },
    } as never,
    summarizer,
  );
  return { service, appends: () => appends, events };
}
function user(id: string, content: string): ConversationTreeEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: { role: "user", content, timestamp: 0 },
  };
}
describe("compaction integrity", () => {
  it("persists an estimate of the actual repeated-checkpoint context without mutating signed messages", async () => {
    const branch: ConversationTreeEntry[] = [
      user("request", "old request ".repeat(10_000)),
    ];
    for (let i = 0; i < 38; i++)
      branch.push({
        type: "message",
        id: `signed_${i}`,
        parentId: branch.at(-1)!.id,
        timestamp,
        message: {
          role: "assistant",
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "test",
          timestamp: 0,
          stopReason: "stop",
          content: [
            {
              type: "thinking",
              thinking: "",
              thinkingSignature: "opaque-fixture",
            },
          ],
          usage: {
            input: 100_000,
            output: 4_000,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 104_000,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
      });
    branch.push(
      {
        type: "compaction",
        id: "previous",
        parentId: branch.at(-1)!.id,
        timestamp,
        summary: "Old checkpoint",
        firstKeptEntryId: "request",
        tokensBefore: 100_000,
        details: { tokensAfter: 1 },
      },
      user("recent", "status?"),
    );
    const copy = structuredClone(branch);
    const { service } = setup(branch, async () => ({
      text: summary,
      generatedBy: "model",
    }));
    const result = await service.compactConversation("conv_test", {
      keepRecentTokens: 20_000,
    });
    const messages = buildConversationContext(branch).messages;
    const details = result.entry.details as {
      tokensAfter: number;
      accounting: unknown;
    };
    assert.equal(details.tokensAfter, estimateRetainedContextTokens(messages));
    assert.ok(details.tokensAfter < 21_000);
    assert.ok(messages.filter((m) => m.role === "assistant").length < 6);
    assert.deepEqual(branch.slice(0, copy.length), copy);
    const accounting = compactionAccountingSchema.parse(details.accounting);
    assert.equal(accounting.retentionBudgetExceeded, false);
    assert.equal(
      accounting.retainedTokens + accounting.summaryTokens,
      details.tokensAfter,
    );
  });
  it("does not commit on unavailable, failing, or invalid summarization", async () => {
    for (const summarizer of [
      undefined,
      async () => undefined,
      async () => {
        throw new Error("provider unavailable");
      },
      async () => ({ text: "incomplete", generatedBy: "model" as const }),
    ]) {
      const branch = [
        user("old", "x".repeat(20_000)),
        user("recent", "continue"),
      ];
      const { service, appends, events } = setup(branch, summarizer);
      await assert.rejects(
        service.compactConversation("conv_test", { keepRecentTokens: 1 }),
      );
      assert.equal(appends(), 0);
      assert.equal(branch.length, 2);
      assert.equal(events.includes("conversation.compacted"), false);
      assert.equal(events.includes("conversation.compaction.failed"), true);
    }
  });
  it("rejects supplied invalid summary budgets before calling a model", async () => {
    for (const summaryReserveTokens of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      500,
    ]) {
      let calls = 0;
      const { service, appends } = setup(
        [user("old", "x".repeat(20_000)), user("recent", "continue")],
        async () => {
          calls++;
          return { text: summary, generatedBy: "model" };
        },
      );
      await assert.rejects(
        service.compactConversation(
          "conv_test",
          { keepRecentTokens: 1 },
          { summaryReserveTokens },
        ),
      );
      assert.equal(calls, 0);
      assert.equal(appends(), 0);
    }
  });
  it("does not expose raw provider errors through the public failure", async () => {
    const secret =
      "Authorization: Bearer synthetic-secret request-private-text";
    const { service } = setup(
      [user("old", "x".repeat(20_000)), user("recent", "continue")],
      async () => {
        throw new Error(secret);
      },
    );
    await assert.rejects(
      service.compactConversation("conv_test", { keepRecentTokens: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Summary generation failed/);
        assert.doesNotMatch(
          error.message,
          /synthetic-secret|request-private-text/,
        );
        return true;
      },
    );
  });

  it("rejects ineffective manual and automatic summaries before append", async () => {
    for (const reason of ["manual", "threshold"] as const) {
      const { service, appends } = setup(
        [user("old", "old"), user("recent", "new")],
        async () => ({ text: summary, generatedBy: "model" }),
      );
      await assert.rejects(
        service.compactConversation(
          "conv_test",
          { keepRecentTokens: 1 },
          { reason },
        ),
        /would not reduce/,
      );
      assert.equal(appends(), 0);
    }
  });
});
