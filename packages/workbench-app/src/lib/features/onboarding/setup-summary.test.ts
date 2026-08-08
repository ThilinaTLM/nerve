import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelInfo, Settings } from "@nervekit/contracts";
import { summarizeAgentDefaults } from "./setup-summary.js";

const models: ModelInfo[] = [
  {
    provider: "openai",
    modelId: "gpt-5",
    name: "GPT 5",
    label: "GPT 5",
    reasoning: true,
    input: ["text"],
    supportedThinkingLevels: ["off", "high"],
    contextWindow: 0,
    maxOutputTokens: 0,
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet",
    name: "Claude Sonnet",
    label: "Claude Sonnet",
    reasoning: true,
    input: ["text"],
    supportedThinkingLevels: ["off", "medium"],
    contextWindow: 0,
    maxOutputTokens: 0,
  },
];

const baseSettings = {
  defaultMode: "coding",
  defaultPermissionLevel: "autonomous",
  defaultThinkingLevel: "high",
  exploreAgent: { thinkingLevel: "medium" },
} satisfies Pick<
  Settings,
  | "defaultMode"
  | "defaultPermissionLevel"
  | "defaultThinkingLevel"
  | "exploreAgent"
>;

describe("onboarding setup summaries", () => {
  it("shows catalog names for explicit main and Explore models", () => {
    const summary = summarizeAgentDefaults(
      {
        ...baseSettings,
        defaultModel: { provider: "openai", modelId: "gpt-5" },
        exploreAgent: {
          model: { provider: "anthropic", modelId: "claude-sonnet" },
          thinkingLevel: "medium",
        },
      },
      models,
    );
    assert.equal(summary.configured, true);
    assert.match(summary.text, /Main: GPT 5 \(high\)/);
    assert.match(summary.text, /Explore: Claude Sonnet \(medium\)/);
  });

  it("describes valid model fallbacks without reporting them configured", () => {
    const summary = summarizeAgentDefaults(baseSettings, models);
    assert.equal(summary.configured, false);
    assert.match(summary.text, /Main: First available scoped model/);
    assert.match(summary.text, /Explore: Default model/);
  });
});
