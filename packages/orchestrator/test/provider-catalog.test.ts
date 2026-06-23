import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ProviderCatalogStore } from "../src/domains/providers/provider-catalog.store.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempStore(): Promise<ProviderCatalogStore> {
  const root = await mkdtemp(join(tmpdir(), "nerve-catalog-"));
  roots.push(root);
  return new ProviderCatalogStore(join(root, "providers.json"));
}

describe("ProviderCatalogStore", () => {
  it("inherits connection settings from the custom provider", async () => {
    const store = await tempStore();
    await store.upsertProvider({
      id: "ollama",
      displayName: "Ollama",
      api: "openai-completions",
      baseUrl: "http://localhost:11434/v1",
      headers: { "X-Test": "1" },
    });
    await store.upsertModel({
      provider: "ollama",
      modelId: "llama-3.1-8b",
      name: "Llama 3.1 8B",
      reasoning: false,
      supportedThinkingLevels: ["off"],
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 32_000,
      headers: { "X-Model": "2" },
    });

    const resolved = store.resolvedModels();
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].api, "openai-completions");
    assert.equal(resolved[0].baseUrl, "http://localhost:11434/v1");
    assert.deepEqual(resolved[0].headers, { "X-Test": "1", "X-Model": "2" });
  });

  it("keeps built-in provider models without explicit connection settings", async () => {
    const store = await tempStore();
    await store.upsertModel({
      provider: "anthropic",
      modelId: "claude-x",
      name: "Claude X",
      reasoning: true,
      supportedThinkingLevels: ["off"],
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 0,
      maxTokens: 0,
    });
    const resolved = store.resolvedModels();
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].provider, "anthropic");
    assert.equal(resolved[0].api, undefined);
    assert.equal(resolved[0].baseUrl, undefined);
  });

  it("cascades model deletion when a provider is removed", async () => {
    const store = await tempStore();
    await store.upsertProvider({
      id: "ollama",
      displayName: "Ollama",
      api: "openai-completions",
      baseUrl: "http://localhost:11434/v1",
      headers: {},
    });
    await store.upsertModel({
      provider: "ollama",
      modelId: "llama-3.1-8b",
      name: "Llama 3.1 8B",
      reasoning: false,
      supportedThinkingLevels: ["off"],
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 32_000,
    });

    const after = await store.deleteProvider("ollama");
    assert.equal(after.providers.length, 0);
    assert.equal(after.models.length, 0);
  });

  it("persists and reloads the catalog from disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-catalog-"));
    roots.push(root);
    const path = join(root, "providers.json");
    const store = new ProviderCatalogStore(path);
    await store.upsertProvider({
      id: "vllm",
      displayName: "vLLM",
      api: "openai-completions",
      baseUrl: "http://localhost:8000/v1",
      headers: {},
    });

    const reloaded = new ProviderCatalogStore(path);
    const catalog = await reloaded.load();
    assert.equal(catalog.providers.length, 1);
    assert.equal(catalog.providers[0].id, "vllm");
  });
});
