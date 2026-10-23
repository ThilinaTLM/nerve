import assert from "node:assert/strict";
import test from "node:test";
import type { AuthManager } from "../domains/auth/index.js";
import type { ProviderCatalogStore } from "../domains/providers/provider-catalog.store.js";
import { createModelPort, type ModelConfiguration } from "./model.adapter.js";

void test("captured auxiliary model configuration resolves current secrets without reselecting endpoints or headers", async () => {
  const configuration = {
    providers: [
      {
        id: "captured-provider",
        api: "openai-completions",
        baseUrl: "https://original.example/v1",
        headers: { Authorization: { credential: "captured-header" } },
      },
    ],
    models: [
      {
        provider: "captured-provider",
        modelId: "model",
        name: "Captured model",
        reasoning: false,
        input: ["text"],
        contextWindow: 10000,
        maxTokens: 1000,
      },
    ],
  } as unknown as ModelConfiguration;
  const catalog = {
    resolvedModelsWithCredentials: async () => {
      throw new Error("Must not re-read current catalog");
    },
  } as unknown as ProviderCatalogStore;
  const auth = {
    requestAuthForPiModel: async (model: {
      baseUrl: string;
      headers?: Record<string, string>;
    }) => {
      assert.equal(model.baseUrl, "https://original.example/v1");
      assert.equal(model.headers?.Authorization, "resolved-secret");
      return { apiKey: "current-key" };
    },
  } as unknown as AuthManager;
  let available = true;
  const models = createModelPort(auth, catalog, async (name) => {
    assert.equal(name, "captured-header");
    return available ? "resolved-secret" : undefined;
  });
  const selection = { provider: "captured-provider", modelId: "model" };
  const resolved = await models.resolve(selection, configuration);
  assert.equal(resolved.apiKey, "current-key");
  assert.deepEqual(configuration.providers[0].headers.Authorization, {
    credential: "captured-header",
  });
  available = false;
  await assert.rejects(
    models.resolve(selection, configuration),
    /credential unavailable/,
  );
});
