import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  deriveAutoCompactionPolicy,
  isContextOverflowAssistantMessage,
  shouldAutoCompact,
  shouldCompact,
} from "../src/harness/compaction/compaction.js";

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    ...overrides,
  };
}

function assistant(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: usage(),
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("auto-compaction policy", () => {
  it("derives model-aware threshold and retention for a 200k context", () => {
    const policy = deriveAutoCompactionPolicy(200_000);

    assert.equal(policy.thresholdTokens, 180_000);
    assert.equal(policy.triggerReserveTokens, 20_000);
    assert.equal(policy.keepRecentTokens, 20_000);
    assert.equal(policy.summaryReserveTokens, 16_384);
  });

  it("caps retention for very large context windows", () => {
    assert.equal(
      deriveAutoCompactionPolicy(1_000_000).keepRecentTokens,
      50_000,
    );
  });

  it("keeps at least 4k tokens for small context windows without exceeding half", () => {
    const policy = deriveAutoCompactionPolicy(8_192);

    assert.equal(policy.thresholdTokens, 7_372);
    assert.equal(policy.triggerReserveTokens, 820);
    assert.equal(policy.keepRecentTokens, 4_000);
    assert.ok(
      policy.keepRecentTokens <= Math.floor(policy.contextWindow * 0.5),
    );
  });

  it("does not auto-compact unknown usage or unknown context windows", () => {
    const policy = deriveAutoCompactionPolicy(0);

    assert.equal(shouldAutoCompact(null, policy), false);
    assert.equal(shouldAutoCompact(undefined, policy), false);
    assert.equal(shouldAutoCompact(1_000_000, policy), false);
  });

  it("triggers at the derived threshold", () => {
    const policy = deriveAutoCompactionPolicy(200_000);

    assert.equal(shouldAutoCompact(policy.thresholdTokens - 1, policy), false);
    assert.equal(shouldAutoCompact(policy.thresholdTokens, policy), true);
  });

  it("guards legacy shouldCompact callers with unknown context windows", () => {
    assert.equal(
      shouldCompact(100_000, 0, {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      }),
      false,
    );
  });
});

describe("context overflow detection", () => {
  it("detects Anthropic prompt-too-long errors", () => {
    assert.equal(
      isContextOverflowAssistantMessage(
        assistant({
          stopReason: "error",
          errorMessage: "prompt is too long: 213462 tokens > 200000 maximum",
        }),
      ),
      true,
    );
  });

  it("detects generic context-window errors", () => {
    assert.equal(
      isContextOverflowAssistantMessage(
        assistant({
          stopReason: "error",
          errorMessage: "Your input exceeds the context window of this model",
        }),
      ),
      true,
    );
  });

  it("detects Ollama max context length errors", () => {
    assert.equal(
      isContextOverflowAssistantMessage(
        assistant({
          stopReason: "error",
          errorMessage:
            "prompt too long; exceeded max context length by 150 tokens",
        }),
      ),
      true,
    );
  });

  it("does not treat rate limits or throttling as overflow", () => {
    assert.equal(
      isContextOverflowAssistantMessage(
        assistant({ stopReason: "error", errorMessage: "rate limit exceeded" }),
      ),
      false,
    );
    assert.equal(
      isContextOverflowAssistantMessage(
        assistant({
          stopReason: "error",
          errorMessage:
            "ThrottlingException: Too many tokens, please wait before trying again.",
        }),
      ),
      false,
    );
  });

  it("detects silent overflow from successful usage over the context window", () => {
    assert.equal(
      isContextOverflowAssistantMessage(
        assistant({ usage: usage({ input: 200_001, totalTokens: 200_001 }) }),
        200_000,
      ),
      true,
    );
  });
});
