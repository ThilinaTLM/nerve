import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModels,
  fauxProvider,
  InMemoryCredentialStore,
  type Provider,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { AuthManager } from "../domains/auth/auth-manager.js";
import type { AgentCustomModel } from "@nervekit/harness/models";
import { createProfileModelInfo } from "./profile-model-availability.js";

const model = (patch: Partial<AgentCustomModel> = {}): AgentCustomModel => ({
  provider: "openai",
  modelId: "profile-test",
  name: "Profile test",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 1024,
  ...patch,
});

void test("known missing provider credentials are diagnosed without requesting auth", async () => {
  const check = createProfileModelInfo({
    customModels: () => [model()],
    providerMetadata: async () => ({
      supportsApiKey: true,
      supportsOAuth: true,
      configured: false,
    }),
  });
  await assert.rejects(
    check({ provider: "openai", modelId: "profile-test" }),
    /Configure this provider's credentials/,
  );
});

void test("explicit custom endpoints remain usable without credentials, including builtin provider names", async () => {
  const check = createProfileModelInfo({
    customModels: () => [model({ baseUrl: "http://localhost:1234/v1" })],
    providerMetadata: async () => {
      throw new Error("Custom endpoint must not require credentials");
    },
  });
  const info = await check({ provider: "openai", modelId: "profile-test" });
  assert.equal(info.modelId, "profile-test");
  assert.deepEqual(info.supportedThinkingLevels, ["off"]);
  await assert.rejects(
    check({ provider: "missing-provider", modelId: "missing-model" }),
    /Unknown or unconfigured model/,
  );
});

function authFor(
  provider: Provider,
  env: (name: string) => Promise<string | undefined>,
) {
  const credentials = new InMemoryCredentialStore();
  const models = createModels({
    credentials,
    authContext: { env, fileExists: async () => false },
  });
  models.setProvider(provider);
  const unexpected = async (): Promise<never> => {
    throw new Error("Encrypted secrets must not be accessed");
  };
  const auth = new AuthManager(
    { get: unexpected, set: unexpected, delete: unexpected, list: unexpected },
    { credentials, models },
  );
  return { auth, models };
}

void test("ambient provider auth is available with no stored credential and no request-time auth resolution", async (t) => {
  const reads: string[] = [];
  const { auth, models } = authFor(openaiProvider(), async (name) => {
    reads.push(name);
    return name === "OPENAI_API_KEY" ? "test-only-placeholder" : undefined;
  });
  t.mock.method(models, "getAuth", async () => {
    throw new Error("Request-time auth must not be called");
  });
  assert.equal(await auth.credentialType("openai"), undefined);
  const check = createProfileModelInfo({
    customModels: () => [model()],
    providerMetadata: async (provider) =>
      (await auth.listProviderMetadata()).find(
        (metadata) => metadata.provider === provider,
      ),
  });
  assert.equal(
    (await check({ provider: "openai", modelId: "profile-test" })).modelId,
    "profile-test",
  );
  assert.ok(reads.includes("OPENAI_API_KEY"));
});

void test("auth-free SDK provider is available without an encrypted credential", async (t) => {
  const { auth, models } = authFor(
    fauxProvider({ provider: "openai" }).provider,
    async () => undefined,
  );
  t.mock.method(models, "getAuth", async () => {
    throw new Error("Request-time auth must not be called");
  });
  assert.equal(await auth.credentialType("openai"), undefined);
  const check = createProfileModelInfo({
    customModels: () => [model()],
    providerMetadata: async (provider) =>
      (await auth.listProviderMetadata()).find(
        (metadata) => metadata.provider === provider,
      ),
  });
  assert.equal(
    (await check({ provider: "openai", modelId: "profile-test" })).modelId,
    "profile-test",
  );
});

void test("provider existence without declared auth methods does not require credentials", async () => {
  const check = createProfileModelInfo({
    customModels: () => [model()],
    providerMetadata: async () => ({
      supportsApiKey: false,
      supportsOAuth: false,
      configured: false,
    }),
  });
  assert.equal(
    (await check({ provider: "openai", modelId: "profile-test" })).modelId,
    "profile-test",
  );
});
