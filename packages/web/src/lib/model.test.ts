import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthProviderMetadata, ModelInfo } from "./api";
import { scopedUsableModelOptions, usableModelOptions } from "./utils/model";

const models: ModelInfo[] = [
  {
    provider: "nerve-faux",
    modelId: "faux-fast",
    label: "Nerve Faux Fast",
    reasoning: false,
    supportedThinkingLevels: ["off"],
    faux: true,
    contextWindow: 0,
    maxOutputTokens: 0,
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    label: "anthropic / claude-opus-4-8",
    reasoning: true,
    supportedThinkingLevels: ["off", "high"],
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
  },
  {
    provider: "openai",
    modelId: "gpt-5.2",
    label: "openai / gpt-5.2",
    reasoning: true,
    supportedThinkingLevels: ["off", "high"],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
  },
];

const providers: AuthProviderMetadata[] = [
  {
    provider: "anthropic",
    displayName: "Anthropic",
    supportsApiKey: true,
    supportsOAuth: true,
    configured: true,
  },
  {
    provider: "openai",
    displayName: "OpenAI",
    supportsApiKey: true,
    supportsOAuth: false,
    configured: false,
  },
];

describe("model option filtering", () => {
  it("keeps existing usable model behavior", () => {
    assert.deepEqual(
      usableModelOptions(models, providers).map((model) => model.modelId),
      ["faux-fast", "claude-opus-4-8"],
    );
  });

  it("treats an empty scope as all usable models", () => {
    assert.deepEqual(
      scopedUsableModelOptions(models, providers, []).map(
        (model) => model.modelId,
      ),
      ["faux-fast", "claude-opus-4-8"],
    );
  });

  it("filters usable models by a non-empty scope", () => {
    assert.deepEqual(
      scopedUsableModelOptions(models, providers, [
        { provider: "anthropic", modelId: "claude-opus-4-8" },
      ]).map((model) => model.modelId),
      ["claude-opus-4-8"],
    );
  });

  it("ignores scoped models from unauthenticated providers", () => {
    assert.deepEqual(
      scopedUsableModelOptions(models, providers, [
        { provider: "openai", modelId: "gpt-5.2" },
      ]),
      [],
    );
  });
});
