import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelInfo } from "@nervekit/contracts/models";
import {
  buildModelCatalog,
  filterModelCatalog,
  modelProviderFacets,
} from "./model-catalog";

function model(provider: string, modelId: string, name: string): ModelInfo {
  return {
    provider,
    modelId,
    name,
    label: name,
    reasoning: false,
    input: ["text"],
    supportedThinkingLevels: ["off"],
    contextWindow: 0,
    maxOutputTokens: 0,
  };
}

describe("model catalog", () => {
  const models = [
    model("openrouter", "vendor/zeta", "Shared"),
    model("anthropic", "claude-shared", "Shared"),
    model("openrouter", "vendor/alpha", "Alpha"),
  ];

  it("sorts deterministically and precomputes duplicate-aware labels", () => {
    const entries = buildModelCatalog(models);

    assert.deepEqual(
      entries.map((entry) => entry.key),
      [
        "anthropic:claude-shared",
        "openrouter:vendor/alpha",
        "openrouter:vendor/zeta",
      ],
    );
    assert.equal(entries[0]?.contextualLabel, "Anthropic / Shared");
    assert.equal(entries[2]?.contextualLabel, "OpenRouter / Shared");
  });

  it("searches names, raw model ids, and providers and filters facets", () => {
    const entries = buildModelCatalog(models);

    assert.deepEqual(
      filterModelCatalog(entries, "vendor/zeta").map((entry) => entry.key),
      ["openrouter:vendor/zeta"],
    );
    assert.equal(filterModelCatalog(entries, "anthropic").length, 1);
    assert.deepEqual(
      filterModelCatalog(entries, "shared", "openrouter").map(
        (entry) => entry.key,
      ),
      ["openrouter:vendor/zeta"],
    );
    assert.deepEqual(modelProviderFacets(entries), [
      { id: "all", label: "All", count: 3 },
      { id: "anthropic", label: "Anthropic", count: 1 },
      { id: "openrouter", label: "OpenRouter", count: 2 },
    ]);
  });

  it("keeps every entry in a large provider catalog", () => {
    const entries = buildModelCatalog(
      Array.from({ length: 500 }, (_, index) =>
        model("openrouter", `vendor/model-${index}`, `Model ${index}`),
      ),
    );

    assert.equal(entries.length, 500);
    assert.deepEqual(
      filterModelCatalog(entries, "vendor/model-499").map(
        (entry) => entry.model.modelId,
      ),
      ["vendor/model-499"],
    );
  });
});
