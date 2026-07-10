import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ModelInfo, thinkingLevels } from "@nervekit/shared";
import {
  clampThinkingLevelForModel,
  THINKING_LEVEL_ORDER,
} from "./thinking-levels.js";

function model(
  supportedThinkingLevels: ModelInfo["supportedThinkingLevels"],
): ModelInfo {
  return {
    provider: "test",
    modelId: "reasoning-model",
    name: "Reasoning model",
    label: "Reasoning model",
    reasoning: true,
    supportedThinkingLevels,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
  };
}

describe("thinking level ordering", () => {
  it("tracks the shared canonical order", () => {
    assert.deepEqual(THINKING_LEVEL_ORDER, [...thinkingLevels]);
    assert.deepEqual(THINKING_LEVEL_ORDER.slice(-2), ["xhigh", "max"]);
  });

  it("clamps across model-specific xhigh and max support", () => {
    assert.equal(
      clampThinkingLevelForModel("xhigh", model(["off", "high", "max"])),
      "max",
    );
    assert.equal(
      clampThinkingLevelForModel("max", model(["off", "high", "xhigh"])),
      "xhigh",
    );
  });
});
