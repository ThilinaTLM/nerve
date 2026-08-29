import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import {
  conversationUsageMetrics,
  emptyConversationUsage,
  summarizeConversationUsage,
} from "./conversation-usage.js";

describe("conversation usage", () => {
  it("returns an explicit empty summary without provider usage", () => {
    const summary = summarizeConversationUsage([{}]);

    assert.deepEqual(summary, emptyConversationUsage());
    assert.deepEqual(conversationUsageMetrics(summary), {
      ...emptyConversationUsage(),
      hasUsage: false,
      promptTokens: 0,
      cachedTokens: 0,
      uncachedTokens: 0,
      cacheRate: null,
    });
  });

  it("aggregates provider totals and derives cache accounting", () => {
    const summary = summarizeConversationUsage([
      entryUsage(100, 20, 300, 40, 460, 1.25),
      entryUsage(50, 10, 500, 20, 580, 0.75),
    ]);

    assert.deepEqual(summary, {
      responseCount: 2,
      input: 150,
      output: 30,
      cacheRead: 800,
      cacheWrite: 60,
      totalTokens: 1040,
      cost: 2,
    });
    assert.deepEqual(conversationUsageMetrics(summary), {
      ...summary,
      hasUsage: true,
      promptTokens: 1010,
      cachedTokens: 800,
      uncachedTokens: 210,
      cacheRate: (800 / 1010) * 100,
    });
  });

  it("keeps cache rate unavailable when responses report no prompt input", () => {
    const summary = summarizeConversationUsage([
      entryUsage(0, 12, 0, 0, 12, 0),
    ]);

    assert.equal(conversationUsageMetrics(summary).hasUsage, true);
    assert.equal(conversationUsageMetrics(summary).cacheRate, null);
  });

  it("does not retain totals between branch entry arrays", () => {
    const first = summarizeConversationUsage([
      entryUsage(10, 2, 30, 4, 46, 0.1),
      {},
    ]);
    const second = summarizeConversationUsage([
      entryUsage(1, 1, 0, 0, 2, 0.01),
    ]);

    assert.equal(first.totalTokens, 46);
    assert.equal(first.responseCount, 1);
    assert.equal(second.totalTokens, 2);
    assert.equal(second.responseCount, 1);
  });
});

function entryUsage(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  totalTokens: number,
  cost: number,
): Pick<ConversationEntry, "usage"> {
  return {
    usage: { input, output, cacheRead, cacheWrite, totalTokens, cost },
  };
}
