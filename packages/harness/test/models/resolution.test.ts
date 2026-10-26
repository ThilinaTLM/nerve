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

it("declared custom reasoning levels constrain the Pi model, metadata, and every clamp", async () => {
  const { clampAgentThinkingLevel, getAgentModelInfo } =
    await import("../../src/models/resolution.js");
  const { getSupportedThinkingLevels, clampThinkingLevel } =
    await import("@earendil-works/pi-ai");
  const definition = {
    provider: "declared-levels",
    modelId: "low",
    name: "Low",
    api: "openai-completions",
    baseUrl: "http://localhost.invalid/v1",
    reasoning: true,
    supportedThinkingLevels: ["off", "low"] as ("off" | "low")[],
  };
  const model = resolveAgentModel(definition, [definition]);
  assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low"]);
  assert.deepEqual(getAgentModelInfo(model).supportedThinkingLevels, [
    "off",
    "low",
  ]);
  assert.deepEqual(
    listAvailableModels([definition]).find(
      (entry) => entry.provider === definition.provider,
    )?.supportedThinkingLevels,
    ["off", "low"],
  );
  for (const level of ["medium", "high", "xhigh", "max"] as const) {
    assert.equal(
      clampAgentThinkingLevel(definition, level, [definition]),
      "low",
    );
    assert.equal(clampThinkingLevel(model, level), "low");
  }
  assert.equal(clampAgentThinkingLevel(definition, "off", [definition]), "off");
});

it("custom declarations shadow builtin metadata without mutating registered models", async () => {
  const { getAgentModelInfo, clampAgentThinkingLevel } =
    await import("../../src/models/resolution.js");
  const builtin = listAvailableModels().find(
    (model) => model.provider === "openai" && model.reasoning,
  )!;
  const original = getAgentModelInfo(resolveAgentModel(builtin));
  const definition = {
    ...builtin,
    reasoning: true,
    supportedThinkingLevels: ["off", "low"] as ("off" | "low")[],
  };
  const entries = listAvailableModels([definition]).filter(
    (entry) =>
      entry.provider === builtin.provider && entry.modelId === builtin.modelId,
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].supportedThinkingLevels, ["off", "low"]);
  assert.equal(clampAgentThinkingLevel(builtin, "high", [definition]), "low");
  assert.deepEqual(getAgentModelInfo(resolveAgentModel(builtin)), original);
});

it("non-reasoning models cannot advertise declared reasoning levels", async () => {
  const { getAgentModelInfo, clampAgentThinkingLevel } =
    await import("../../src/models/resolution.js");
  const definition = {
    provider: "declared-non-reasoning",
    modelId: "off",
    name: "Off",
    api: "openai-completions",
    baseUrl: "http://localhost.invalid/v1",
    reasoning: false,
    supportedThinkingLevels: ["off", "high"] as ("off" | "high")[],
  };
  assert.deepEqual(
    getAgentModelInfo(resolveAgentModel(definition, [definition]))
      .supportedThinkingLevels,
    ["off"],
  );
  assert.equal(
    clampAgentThinkingLevel(definition, "high", [definition]),
    "off",
  );
});
