import assert from "node:assert/strict";
import test from "node:test";
import { getRegisteredModels } from "@nervekit/harness/models";
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
  assert.equal(resolved.model.baseUrl, "https://original.example/v1");
  assert.deepEqual(configuration.providers[0].headers.Authorization, {
    credential: "captured-header",
  });
  available = false;
  await assert.rejects(
    models.resolve(selection, configuration),
    /credential unavailable/,
  );
});

void test("Copilot auth endpoints are request-local and preserve credentials", async () => {
  const registered = getRegisteredModels("github-copilot")[0];
  assert.ok(registered, "Expected a bundled Copilot model");
  const original = structuredClone(registered);
  type RequestAuth = Awaited<ReturnType<AuthManager["requestAuthForPiModel"]>>;
  let credentials: RequestAuth = {
    baseUrl: "https://api.enterprise.githubcopilot.com",
    apiKey: "test-key",
    headers: { "X-Test-Auth": "test-header" },
  };
  const auth = {
    requestAuthForPiModel: async (model: typeof registered) => {
      assert.equal(model, registered);
      return credentials;
    },
  } as unknown as AuthManager;
  const catalog = {
    resolvedModelsWithCredentials: async () => [],
  } as unknown as ProviderCatalogStore;
  const models = createModelPort(auth, catalog, async () => undefined);
  const selection = { provider: registered.provider, modelId: registered.id };
  const resolved = await models.resolve(selection);
  assert.notEqual(resolved.model, registered);
  assert.deepEqual(resolved.model, {
    ...original,
    baseUrl: "https://api.enterprise.githubcopilot.com",
  });
  assert.equal(resolved.apiKey, "test-key");
  assert.deepEqual(resolved.headers, { "X-Test-Auth": "test-header" });
  assert.deepEqual(registered, original);

  for (const fallback of [undefined, { apiKey: "test-key" }, { baseUrl: "" }]) {
    credentials = fallback;
    const next = await models.resolve(selection);
    assert.equal(next.model, registered);
    assert.equal(next.model.baseUrl, original.baseUrl);
  }
});

void test("authenticated endpoints override captured configuration without changing it", async () => {
  const configuration = {
    providers: [
      {
        id: "captured-provider",
        api: "openai-completions",
        baseUrl: "https://configured.example/v1",
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
  const original = structuredClone(configuration);
  const auth = {
    requestAuthForPiModel: async (model: { baseUrl: string }) => {
      assert.equal(model.baseUrl, "https://configured.example/v1");
      return { baseUrl: "https://authenticated.example/v1" };
    },
  } as unknown as AuthManager;
  const catalog = {
    resolvedModelsWithCredentials: async () => {
      throw new Error("Must not re-read current catalog");
    },
  } as unknown as ProviderCatalogStore;
  const models = createModelPort(auth, catalog, async () => undefined);
  const resolved = await models.resolve(
    { provider: "captured-provider", modelId: "model" },
    configuration,
  );
  assert.equal(resolved.model.baseUrl, "https://authenticated.example/v1");
  assert.deepEqual(configuration, original);
});
