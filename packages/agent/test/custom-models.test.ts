import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type AgentCustomModel,
  listAvailableModels,
  resolveAgentModel,
  setCustomModelProvider,
} from "../src/runtime.js";

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

  it("includes custom models in listAvailableModels", () => {
    const listed = listAvailableModels([ollama]);
    const entry = listed.find(
      (model) =>
        model.provider === "ollama" && model.modelId === "llama-3.1-8b",
    );
    assert.ok(entry, "expected custom model in the list");
    assert.equal(entry?.contextWindow, 128_000);
  });
});
