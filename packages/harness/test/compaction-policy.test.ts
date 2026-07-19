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
  it("derives the balanced model-aware policy for a 200k context", () => {
    const policy = deriveAutoCompactionPolicy(200_000);

    assert.equal(policy.profile, "balanced");
    assert.equal(policy.thresholdPercent, 80);
    assert.equal(policy.keepRecentPercent, 15);
    assert.equal(policy.thresholdTokens, 160_000);
    assert.equal(policy.triggerReserveTokens, 40_000);
    assert.equal(policy.keepRecentTokens, 30_000);
    assert.equal(policy.summaryReserveTokens, 16_000);
    assert.equal(policy.safetyHeadroomTokens, 20_000);
  });

  it("resolves aggressive, conservative, and custom profiles", () => {
    assert.deepEqual(
      pickPercentages(
        deriveAutoCompactionPolicy(200_000, {
          auto: true,
          profile: "aggressive",
          customTriggerPercent: 80,
          customKeepRecentPercent: 15,
        }),
      ),
      [70, 10],
    );
    assert.deepEqual(
      pickPercentages(
        deriveAutoCompactionPolicy(200_000, {
          auto: true,
          profile: "conservative",
          customTriggerPercent: 80,
          customKeepRecentPercent: 15,
        }),
      ),
      [90, 25],
    );
    assert.deepEqual(
      pickPercentages(
        deriveAutoCompactionPolicy(200_000, {
          auto: true,
          profile: "custom",
          customTriggerPercent: 75,
          customKeepRecentPercent: 20,
        }),
      ),
      [75, 20],
    );
  });

  it("keeps summary, retained context, and safety within the threshold", () => {
    for (const contextWindow of [4_096, 8_192, 200_000, 1_000_000]) {
      const policy = deriveAutoCompactionPolicy(contextWindow);
      assert.ok(policy.summaryReserveTokens <= 16_384);
      assert.ok(
        policy.keepRecentTokens +
          policy.summaryReserveTokens +
          policy.safetyHeadroomTokens <=
          policy.thresholdTokens,
      );
    }
  });

  it("does not auto-compact unknown usage, unknown windows, or when disabled", () => {
    const unknown = deriveAutoCompactionPolicy(0);
    const disabled = deriveAutoCompactionPolicy(200_000, {
      auto: false,
      profile: "balanced",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    });

    assert.equal(shouldAutoCompact(null, unknown), false);
    assert.equal(shouldAutoCompact(undefined, unknown), false);
    assert.equal(shouldAutoCompact(1_000_000, unknown), false);
    assert.equal(shouldAutoCompact(200_000, disabled), false);
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

function pickPercentages(policy: {
  thresholdPercent: number;
  keepRecentPercent: number;
}): [number, number] {
  return [policy.thresholdPercent, policy.keepRecentPercent];
}

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
