import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  piModelConfigSchema,
  supportedThinkingLevelsForPiModel,
} from "../src/domains/providers/providers.schema.js";

const oxAlpha = {
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
} as const;

describe("pi model configuration", () => {
  it("accepts a model object copied from pi.dev", () => {
    const parsed = piModelConfigSchema.parse(oxAlpha);

    assert.equal(parsed.id, "ox-alpha-free");
    assert.deepEqual(supportedThinkingLevelsForPiModel(parsed), [
      "low",
      "high",
      "max",
    ]);
  });

  it("applies pi defaults to a minimal model", () => {
    const parsed = piModelConfigSchema.parse({ id: "local-model" });

    assert.equal(parsed.name, undefined);
    assert.equal(parsed.reasoning, false);
    assert.deepEqual(parsed.input, ["text"]);
    assert.equal(parsed.contextWindow, 128_000);
    assert.equal(parsed.maxTokens, 16_384);
    assert.deepEqual(parsed.cost, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    assert.deepEqual(supportedThinkingLevelsForPiModel(parsed), ["off"]);
  });

  it("preserves sampling parameters and tiered costs", () => {
    const parsed = piModelConfigSchema.parse({
      id: "tiered-model",
      samplingParams: { temperature: 0.4, top_k: 20 },
      cost: {
        input: 1,
        output: 2,
        cacheRead: 0.1,
        cacheWrite: 0.2,
        tiers: [
          {
            inputTokensAbove: 272_000,
            input: 2,
            output: 3,
            cacheRead: 0.2,
            cacheWrite: 0.4,
          },
        ],
      },
    });

    assert.deepEqual(parsed.samplingParams, {
      temperature: 0.4,
      top_k: 20,
    });
    assert.equal(parsed.cost.tiers?.[0]?.inputTokensAbove, 272_000);
  });

  it("rejects unknown fields and a full providers envelope", () => {
    assert.equal(
      piModelConfigSchema.safeParse({ id: "model", unexpected: true }).success,
      false,
    );
    assert.equal(
      piModelConfigSchema.safeParse({ providers: { example: {} } }).success,
      false,
    );
  });

  it("rejects invalid values", () => {
    assert.equal(
      piModelConfigSchema.safeParse({ id: "model", input: ["audio"] }).success,
      false,
    );
    assert.equal(
      piModelConfigSchema.safeParse({ id: "model", maxTokens: -1 }).success,
      false,
    );
  });
});
