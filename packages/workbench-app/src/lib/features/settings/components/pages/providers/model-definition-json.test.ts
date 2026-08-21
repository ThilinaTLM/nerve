import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MODEL_JSON,
  modelDefinitionToJson,
  parseModelDefinitionJson,
} from "./model-definition-json.js";

const oxAlphaJson = JSON.stringify({
  id: "ox-alpha-free",
  name: "Ox Alpha Free (Unlimited)",
  reasoning: true,
  input: ["text", "image"],
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  },
  contextWindow: 1_000_000,
  maxTokens: 131_072,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
  },
});

describe("model definition JSON", () => {
  it("converts a pi.dev model object to a Nerve definition", () => {
    const result = parseModelDefinitionJson(oxAlphaJson, "opencode-go");
    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(result.model.provider, "opencode-go");
    assert.equal(result.model.modelId, "ox-alpha-free");
    assert.deepEqual(result.model.supportedThinkingLevels, [
      "low",
      "high",
      "max",
    ]);
    assert.deepEqual(result.model.compat, {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    });
  });

  it("uses pi defaults and the id as the display name", () => {
    const result = parseModelDefinitionJson('{"id":"minimal"}', "ollama");
    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(result.model.name, "minimal");
    assert.equal(result.model.contextWindow, 128_000);
    assert.equal(result.model.maxTokens, 16_384);
    assert.deepEqual(result.model.input, ["text"]);
  });

  it("round trips supported model metadata", () => {
    const initial = parseModelDefinitionJson(oxAlphaJson, "opencode-go");
    assert.equal(initial.success, true);
    if (!initial.success) return;

    const roundTrip = parseModelDefinitionJson(
      modelDefinitionToJson(initial.model),
      "opencode-go",
      "ox-alpha-free",
    );
    assert.deepEqual(roundTrip, initial);
  });

  it("returns actionable validation errors", () => {
    const malformed = parseModelDefinitionJson("{", "ollama");
    assert.equal(malformed.success, false);

    const envelope = parseModelDefinitionJson(
      '{"providers":{"ollama":{}}}',
      "ollama",
    );
    assert.equal(envelope.success, false);
    if (!envelope.success) assert.match(envelope.error, /one model object/i);

    const unknown = parseModelDefinitionJson(
      '{"id":"model","apiKey":"secret"}',
      "ollama",
    );
    assert.equal(unknown.success, false);
  });

  it("prevents changing identity while editing", () => {
    const result = parseModelDefinitionJson(
      '{"id":"different"}',
      "ollama",
      "original",
    );
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error, /cannot be changed/i);
  });

  it("ships a valid default template", () => {
    assert.equal(
      parseModelDefinitionJson(DEFAULT_MODEL_JSON, "ollama").success,
      true,
    );
  });
});
