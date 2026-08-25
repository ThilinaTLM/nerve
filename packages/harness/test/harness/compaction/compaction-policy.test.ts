import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveAutoCompactionPolicy,
  isContextOverflowAssistantMessage,
  shouldAutoCompact,
} from "../../../src/runtime/compaction/compaction.js";

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
