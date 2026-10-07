import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { modelDefinitionSchema } from "@nervekit/contracts/providers";
import { platformMethodHandlers } from "../../../src/adapters/protocol/handlers/platform-method-handlers.js";
import { SqliteIdempotencyStore } from "../../../src/adapters/protocol/sqlite-idempotency-store.js";
import { ProviderCatalogStore } from "../../../src/domains/providers/provider-catalog.store.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

test("actual model upsert persists finite token limits and replays the same catalog without repeating writes/events", async (t) => {
  const home = await mkdtemp(
    join(tmpdir(), "nerve-provider-catalog-idempotency-"),
  );
  const storage = await initializeStorage(home);
  t.after(async () => {
    await storage.canonicalStore.close().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  });
  const catalog = new ProviderCatalogStore(storage);
  const published: string[] = [];
  const state = {
    providerCatalog: catalog,
    events: {
      publish: async (type: string) => {
        published.push(type);
      },
    },
  } as unknown as Parameters<
    (typeof platformMethodHandlers)["providerCatalog.model.upsert"]
  >[0];
  await platformMethodHandlers["providerCatalog.custom.upsert"](state, {
    id: "browser-loopback",
    displayName: "Browser loopback provider",
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:49000/v1",
    headers: {},
  });
  const params = modelDefinitionSchema.parse({
    provider: "browser-loopback",
    modelId: "original",
    name: "Loopback original",
    reasoning: false,
    supportedThinkingLevels: ["off"],
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  });
  let executions = 0;
  const operation = async () => {
    executions++;
    return {
      status: "success" as const,
      result: await platformMethodHandlers["providerCatalog.model.upsert"](
        state,
        params,
      ),
    };
  };
  const store = new SqliteIdempotencyStore(storage.canonicalStore);
  const first = await store.execute(
    "ui",
    "register-model",
    "providerCatalog.model.upsert",
    params,
    operation,
  );
  assert.equal(first.outcome?.status, "success", JSON.stringify(first.outcome));
  const expected = { status: "success", result: catalog.catalog };
  assert.deepEqual(first.outcome, expected);
  assert.equal(catalog.catalog.models[0]?.maxTokens, 4096);
  const persistedConfig = await readFile(
    storage.paths.providersConfigPath,
    "utf8",
  );
  const eventCount = published.length;
  const duplicate = await store.execute(
    "ui",
    "register-model",
    "providerCatalog.model.upsert",
    params,
    operation,
  );
  assert.equal(duplicate.status, "replayed");
  assert.deepEqual(duplicate.outcome, expected);
  assert.equal(executions, 1);
  assert.equal(published.length, eventCount);
  assert.equal(
    await readFile(storage.paths.providersConfigPath, "utf8"),
    persistedConfig,
  );
  await storage.canonicalStore.close();
  const reopened = new CanonicalStore(storage.paths.sqlitePath);
  await reopened.initialize();
  t.after(() => reopened.close());
  const replay = await new SqliteIdempotencyStore(reopened).execute(
    "ui",
    "register-model",
    "providerCatalog.model.upsert",
    params,
    operation,
  );
  assert.equal(replay.status, "replayed");
  assert.deepEqual(replay.outcome, expected);
  assert.equal(executions, 1);
  assert.equal(published.length, eventCount);
});
