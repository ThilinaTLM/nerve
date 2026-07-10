import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type AgentCustomModel,
  listAvailableModels,
  resolveAgentModel,
  setCustomModelProvider,
} from "../src/runtime.js";

const openAiManual: AgentCustomModel = {
  provider: "openai",
  modelId: "custom-gpt",
  name: "Custom GPT",
  reasoning: true,
  supportedThinkingLevels: ["off", "low"],
  input: ["text"],
  contextWindow: 256_000,
  maxTokens: 16_000,
};

const ollama: AgentCustomModel = {
  provider: "ollama",
  modelId: "llama-3.1-8b",
  name: "Llama 3.1 8B",
  api: "openai-completions",
  baseUrl: "http://localhost:11434/v1",
  reasoning: false,
  supportedThinkingLevels: ["off"],
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 32_000,
};

describe("custom model resolution", () => {
  afterEach(() => setCustomModelProvider(undefined));

  it("resolves an explicit custom model into a pi-ai model", () => {
    const model = resolveAgentModel(
      { provider: "ollama", modelId: "llama-3.1-8b" },
      [ollama],
    );
    assert.equal(model.provider, "ollama");
    assert.equal(model.id, "llama-3.1-8b");
    assert.equal(model.api, "openai-completions");
    assert.equal(model.baseUrl, "http://localhost:11434/v1");
    assert.equal(model.contextWindow, 128_000);
  });

  it("falls back to the faux model for unknown providers without a definition", () => {
    const model = resolveAgentModel({
      provider: "ollama",
      modelId: "llama-3.1-8b",
    });
    assert.equal(model.provider, "nerve-faux");
  });

  it("uses the registered custom-model provider when no explicit list is passed", () => {
    setCustomModelProvider(() => [ollama]);
    const model = resolveAgentModel({
      provider: "ollama",
      modelId: "llama-3.1-8b",
    });
    assert.equal(model.provider, "ollama");
    assert.equal(model.baseUrl, "http://localhost:11434/v1");
  });

  it("inherits connection settings for manual models under known providers", () => {
    const model = resolveAgentModel(
      { provider: "openai", modelId: "custom-gpt" },
      [openAiManual],
    );
    assert.equal(model.provider, "openai");
    assert.equal(model.id, "custom-gpt");
    assert.equal(model.api, "openai-responses");
    assert.equal(model.baseUrl, "https://api.openai.com/v1");
    assert.equal(model.contextWindow, 256_000);
  });

  it("includes custom models in listAvailableModels", () => {
    const listed = listAvailableModels([ollama, openAiManual]);
    const entry = listed.find(
      (model) =>
        model.provider === "ollama" && model.modelId === "llama-3.1-8b",
    );
    assert.ok(entry, "expected custom model in the list");
    assert.equal(entry?.contextWindow, 128_000);
    const inherited = listed.find(
      (model) => model.provider === "openai" && model.modelId === "custom-gpt",
    );
    assert.ok(inherited, "expected inherited provider model in the list");
    assert.deepEqual(inherited.supportedThinkingLevels, ["off", "low"]);
  });

  it("exposes upstream GPT-5.6 variants without the nonexistent alias", () => {
    const listed = listAvailableModels();
    const variantIds = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"];

    for (const provider of ["openai", "openai-codex"]) {
      const providerModels = listed.filter(
        (model) => model.provider === provider,
      );
      const providerIds = new Set(providerModels.map((model) => model.modelId));
      for (const variantId of variantIds) {
        assert.ok(
          providerIds.has(variantId),
          `expected ${provider}/${variantId}`,
        );
      }
      assert.equal(providerIds.has("gpt-5.6"), false);

      const sol = providerModels.find(
        (model) => model.modelId === "gpt-5.6-sol",
      );
      assert.deepEqual(sol?.supportedThinkingLevels, [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
    }

    const unresolvedAlias = resolveAgentModel({
      provider: "openai",
      modelId: "gpt-5.6",
    });
    assert.equal(unresolvedAlias.provider, "nerve-faux");
  });

  it("resolves upstream GPT-5.6 OpenAI metadata", () => {
    const model = resolveAgentModel({
      provider: "openai",
      modelId: "gpt-5.6-sol",
    });

    assert.equal(model.provider, "openai");
    assert.equal(model.id, "gpt-5.6-sol");
    assert.equal(model.api, "openai-responses");
    assert.equal(model.baseUrl, "https://api.openai.com/v1");
    assert.deepEqual(model.input, ["text", "image"]);
    assert.deepEqual(model.cost, {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      tiers: [
        {
          inputTokensAbove: 272_000,
          input: 10,
          output: 45,
          cacheRead: 1,
          cacheWrite: 12.5,
        },
      ],
    });
    assert.equal(model.contextWindow, 272_000);
    assert.equal(model.maxTokens, 128_000);
  });

  it("resolves upstream GPT-5.6 Codex metadata", () => {
    const model = resolveAgentModel({
      provider: "openai-codex",
      modelId: "gpt-5.6-terra",
    });

    assert.equal(model.provider, "openai-codex");
    assert.equal(model.id, "gpt-5.6-terra");
    assert.equal(model.api, "openai-codex-responses");
    assert.equal(model.baseUrl, "https://chatgpt.com/backend-api");
    assert.deepEqual(model.cost, {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 3.125,
      tiers: [
        {
          inputTokensAbove: 272_000,
          input: 5,
          output: 22.5,
          cacheRead: 0.5,
          cacheWrite: 6.25,
        },
      ],
    });
    assert.equal(model.contextWindow, 372_000);
    assert.equal(model.maxTokens, 128_000);
  });

  it("skips unresolved custom models in listAvailableModels", () => {
    const listed = listAvailableModels([
      {
        provider: "missing-provider",
        modelId: "custom-model",
        name: "Custom Model",
        reasoning: false,
      },
    ]);
    assert.equal(
      listed.some((model) => model.provider === "missing-provider"),
      false,
    );
  });
});
