import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listAvailableModels,
  resolveAgentModel,
} from "../../src/models/resolution.js";

describe("model resolution", () => {
  it("lists complete provider catalogs without silently truncating them", () => {
    const openRouterModels = listAvailableModels().filter(
      (model) => model.provider === "openrouter",
    );

    assert.ok(
      openRouterModels.length > 8,
      "expected the registered OpenRouter catalog beyond its first eight models",
    );
    assert.ok(openRouterModels[8]);
    assert.equal(
      new Set(openRouterModels.map((model) => model.modelId)).size,
      openRouterModels.length,
    );
  });

  it("preserves advanced pi model configuration", () => {
    const model = resolveAgentModel(
      { provider: "test-pi-json", modelId: "tiered" },
      [
        {
          provider: "test-pi-json",
          modelId: "tiered",
          name: "Tiered",
          api: "openai-completions",
          baseUrl: "https://example.test/v1",
          reasoning: false,
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
          samplingParams: { temperature: 0.4, top_k: 20 },
        },
      ],
    );

    assert.deepEqual(model.samplingParams, {
      temperature: 0.4,
      top_k: 20,
    });
    assert.equal(model.cost.tiers?.[0]?.inputTokensAbove, 272_000);
  });
});
