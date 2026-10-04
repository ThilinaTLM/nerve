import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCutPoint } from "../../src/compaction/cut-points.js";
import { prepareCompaction } from "../../src/compaction/compaction.js";
import { estimatePostCompactionContext } from "../../src/compaction/checkpoint-accounting.js";
import { estimateRetainedContextTokens } from "../../src/compaction/usage.js";
import { buildConversationContext } from "../../src/conversation/context.js";
import {
  assistant,
  entry,
  user,
  checkpoint,
  timestamp,
} from "./compaction-fixtures.js";

const settings = {
  enabled: true,
  keepRecentTokens: 20_000,
  reserveTokens: 16_384,
};
describe("safe compaction suffixes", () => {
  it("retains an exact-budget suffix and never falls back to the oldest message", () => {
    const entries = [
      entry("old", user("a".repeat(40))),
      entry("middle", user("b".repeat(20))),
      entry("last", user("c".repeat(20))),
    ];
    assert.equal(
      findCutPoint(entries, 0, entries.length, 10).firstKeptEntryIndex,
      1,
    );
    const result = findCutPoint(entries, 0, entries.length, 0);
    assert.equal(result.firstKeptEntryIndex, 2);
    assert.equal(result.retentionBudgetExceeded, true);
  });
  it("keeps complete oversized multi-tool groups across metadata and notices", () => {
    const call = assistant(50);
    call.content.push(
      { type: "toolCall", id: "a", name: "read", arguments: {} },
      { type: "toolCall", id: "b", name: "read", arguments: {} },
    );
    const result = (id: string) =>
      entry(id, {
        role: "toolResult",
        toolCallId: id,
        toolName: "read",
        content: [{ type: "text", text: "x".repeat(40_000) }],
        isError: false,
        timestamp: 0,
      });
    const entries = [
      entry("old", user("old")),
      entry("call", call),
      {
        type: "label" as const,
        id: "label",
        parentId: null,
        timestamp,
        label: "metadata",
      },
      result("a"),
      entry("notice", {
        role: "harness",
        eventType: "task_event",
        content: "done",
        timestamp: 0,
      }),
      result("b"),
    ];
    const copy = structuredClone(entries);
    const cut = findCutPoint(entries, 0, entries.length, 100);
    assert.equal(cut.firstKeptEntryIndex, 1);
    assert.equal(cut.retentionBudgetExceeded, true);
    assert.deepEqual(entries, copy);
    assert.throws(
      () => estimatePostCompactionContext(entries, "a", "summary"),
      /orphan|splits/,
    );
  });
  it("rejects hook boundaries inside unresolved call spans and missing historical boundaries", () => {
    const call = assistant(100);
    call.content.push({
      type: "toolCall",
      id: "pending",
      name: "read",
      arguments: {},
    });
    const entries = [
      entry("old", user("old")),
      entry("call", call),
      entry("notice", {
        role: "harness",
        eventType: "task_event",
        content: "still waiting",
        timestamp: 0,
      }),
    ];
    assert.throws(
      () => estimatePostCompactionContext(entries, "notice", "summary"),
      /splits/,
    );
    entries.push(checkpoint("broken", "missing"));
    assert.throws(
      () => estimatePostCompactionContext(entries, "call", "summary"),
      /missing/,
    );
    assert.equal(prepareCompaction(entries, settings).ok, false);
  });

  it("counts custom and branch summaries and reports nothing when no prefix can be removed", () => {
    const entries = [entry("only", user("hi"))];
    assert.deepEqual(prepareCompaction(entries, settings), {
      ok: true,
      value: undefined,
    });
    const custom = {
      type: "custom_message" as const,
      id: "custom",
      parentId: null,
      timestamp,
      customType: "note",
      content: "x".repeat(400),
      display: true,
    };
    assert.ok(findCutPoint([custom], 0, 1, 1).retainedTokens >= 100);
  });
  it("reconstructs the newest boundary rather than applying an older sliced checkpoint", () => {
    const entries = [
      entry("old", user("older")),
      entry("kept", assistant(10_000)),
      checkpoint("previous", "old"),
      entry("recent", user("new")),
    ];
    const estimate = estimatePostCompactionContext(
      entries,
      "kept",
      "new summary",
    );
    const actual = buildConversationContext([
      ...entries,
      checkpoint("new", "kept", "new summary"),
    ]).messages;
    assert.equal(estimate.tokensAfter, estimateRetainedContextTokens(actual));
    assert.ok(estimate.tokensAfter > 10_000);
    assert.equal(actual.length, 3);
  });
  it("incident-shaped signed history is actually removed before the next request", () => {
    const entries = [
      entry("request", user("Continue the feature")),
      ...Array.from({ length: 38 }, (_, i) =>
        entry(`signed_${i}`, assistant(4_000, i ? 5 : 109)),
      ),
      checkpoint("old_cp", "request"),
      entry("recent", user("status?")),
    ];
    const copy = structuredClone(entries);
    const prepared = prepareCompaction(entries, settings);
    assert.ok(prepared.ok && prepared.value);
    const boundary = prepared.value.firstKeptEntryId;
    assert.notEqual(boundary, "request");
    const next = buildConversationContext([
      ...entries,
      checkpoint("new_cp", boundary, "Continue the unfinished feature"),
      entry("followup", user("What is left?")),
    ]).messages;
    assert.ok(estimateRetainedContextTokens(next) < 21_000);
    assert.ok(next.filter((m) => m.role === "assistant").length < 6);
    assert.deepEqual(entries, copy);
  });
});
