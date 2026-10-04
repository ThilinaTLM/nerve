import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateRetainedMessageTokens,
  estimateRetainedContextTokens,
  getCompactionDecisionTokens,
  computeContextUsage,
} from "../../src/compaction/usage.js";
import { buildConversationContext } from "../../src/conversation/context.js";
import { assistant, entry, checkpoint, user } from "./compaction-fixtures.js";

describe("retained context accounting", () => {
  it("charges signed output once per message, not per block or cumulative request", () => {
    const messages = Array.from({ length: 38 }, (_, i) =>
      assistant(4_000, i ? 5 : 109),
    );
    assert.equal(estimateRetainedContextTokens(messages), 152_000);
    assert.equal(estimateRetainedMessageTokens(assistant(4_000, 294)), 4_000);
  });
  it("uses an opaque-size fallback for invalid output and does not add reasoning twice", () => {
    for (const output of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const message = assistant(output, 3);
      message.usage.reasoning = 0;
      assert.equal(
        estimateRetainedMessageTokens(message),
        Math.ceil((3 * "opaque-test-payload".length) / 4),
      );
    }
    const message = assistant(100);
    message.usage.reasoning = 80;
    assert.equal(estimateRetainedMessageTokens(message), 100);
    message.content = [{ type: "text", text: "visible" }];
    assert.equal(estimateRetainedMessageTokens(message), 2);
  });
  it("prices forwarded harness wrappers and excludes hidden bash output", () => {
    assert.ok(
      estimateRetainedMessageTokens({
        role: "harness",
        eventType: "task_event",
        content: "done",
        timestamp: 0,
      }) > 1,
    );
    assert.equal(
      estimateRetainedMessageTokens({
        role: "bashExecution",
        command: "echo",
        output: "x".repeat(400),
        excludeFromContext: true,
        timestamp: 0,
        exitCode: 0,
        cancelled: false,
        truncated: false,
      }),
      0,
    );
  });
  it("does not trust legacy underestimated checkpoint totals or mutate history", () => {
    const entries = [
      entry("signed", assistant(150_000)),
      checkpoint("cp", "signed"),
      entry("new", user("hello")),
    ];
    const copy = structuredClone(entries);
    const messages = buildConversationContext(entries).messages;
    assert.ok(getCompactionDecisionTokens(messages, entries) > 150_000);
    assert.equal(computeContextUsage(messages, entries, 200_000).tokens, null);
    assert.deepEqual(entries, copy);
    const fresh = assistant(10);
    fresh.usage.totalTokens = 160_000;
    entries.push(entry("fresh", fresh));
    assert.equal(
      getCompactionDecisionTokens(
        buildConversationContext(entries).messages,
        entries,
      ),
      160_000,
    );
  });
});
