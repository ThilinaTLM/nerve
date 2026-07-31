import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAvailableModels } from "../../src/models/resolution.js";

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
});
