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
