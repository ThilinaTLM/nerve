import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { AuthManager } from "../../../src/domains/auth/index.js";
import { EncryptedFileSecretProvider } from "../../../src/infrastructure/secrets/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-auth-"));
  roots.push(root);
  return root;
}

describe("AuthManager", () => {
  it("warns about OpenAI subscription limitations before and after connection without disabling either login", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );
    const before = await auth.listProviderMetadata();
    const openai = before.find((provider) => provider.provider === "openai");
    assert.ok(openai?.warning);
    assert.match(openai.warning, /usage reporting/);
    assert.match(openai.warning, /voice input or image generation/);
    assert.match(
      openai.warning,
      /connect the “OpenAI Codex” subscription in Nerve’s Settings/,
    );
    assert.equal(openai.supportsOAuth, true);
    assert.equal(openai.supportsApiKey, true);
    const codex = before.find(
      (provider) => provider.provider === "openai-codex",
    );
    assert.equal(codex?.supportsOAuth, true);
    assert.equal(codex?.warning, undefined);

    await auth.setOAuth("openai", {
      access: "test-access",
      refresh: "test-refresh",
      expires: Date.now() + 60 * 60_000,
    });
    const connected = (await auth.listProviderMetadata()).find(
      (provider) => provider.provider === "openai",
    );
    assert.equal(connected?.configured, true);
    assert.equal(connected?.credentialType, "oauth");
    assert.equal(connected?.warning, openai.warning);
  });
  it("stores OAuth credentials and resolves access tokens for subscription providers", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );

    await auth.setOAuth("openai-codex", {
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60_000,
    });

    assert.equal(await auth.credentialType("openai-codex"), "oauth");
    assert.equal(await auth.getApiKey("openai-codex"), "access-token");
  });
  it("preserves provider-derived request routing for subscriptions", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );
    await auth.setOAuth("github-copilot", {
      access:
        "tid=test;proxy-ep=proxy.business.githubcopilot.com;exp=9999999999;",
      refresh: "github-token",
      expires: Date.now() + 60 * 60_000,
      enterpriseUrl: "github.example.com",
    });
    const model = auth.models.getModels("github-copilot")[0];
    assert.ok(model);

    const resolved = await auth.requestAuthForPiModel(model);

    assert.equal(resolved?.apiKey?.startsWith("tid=test"), true);
    assert.equal(resolved?.baseUrl, "https://api.business.githubcopilot.com");
  });

  it("treats API keys and OAuth credentials as mutually exclusive", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );

    await auth.setOAuth("anthropic", {
      access: "sk-ant-oat-test",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
    });
    await auth.setApiKey("anthropic", "sk-ant-api-test");

    assert.equal(await auth.credentialType("anthropic"), "api_key");
    assert.equal(await auth.getApiKey("anthropic"), "sk-ant-api-test");
  });

  it("advertises every pi-ai subscription provider", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );

    const providers = await auth.listProviderMetadata();
    const subscriptions = providers
      .filter((provider) => provider.supportsOAuth)
      .map((provider) => provider.provider)
      .sort();

    assert.deepEqual(subscriptions, [
      "anthropic",
      "github-copilot",
      "kimi-coding",
      "meta",
      "openai",
      "openai-codex",
      "openrouter",
      "radius",
      "xai",
    ]);
  });

  it("advertises custom providers without enumerating their models", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );

    const providers = await auth.listProviderMetadata(
      new Map([["custom-compatible", "Custom Compatible"]]),
    );
    const custom = providers.find(
      (provider) => provider.provider === "custom-compatible",
    );

    assert.ok(custom);
    assert.equal(custom.displayName, "Custom Compatible");
    assert.equal(custom.supportsApiKey, true);
  });

  it("includes composite integration profile metadata without env hints", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );
    await auth.setApiKey("atlassian:work", "atlassian-token");
    await auth.setApiKey("tavily:search", "tavily-token");

    const providers = await auth.listProviderMetadata();
    const atlassian = providers.find(
      (provider) => provider.provider === "atlassian:work",
    );
    assert.ok(atlassian);
    assert.equal(atlassian.displayName, "Atlassian profile");
    assert.equal(atlassian.configured, true);
    assert.equal(atlassian.envVar, undefined);
    const tavily = providers.find(
      (provider) => provider.provider === "tavily:search",
    );
    assert.ok(tavily);
    assert.equal(tavily.displayName, "Tavily profile");
    assert.equal(tavily.configured, true);
    assert.equal(tavily.envVar, undefined);
  });
  it("passes a stable installation device ID to OAuth login flows", async () => {
    const home = await tempHome();
    const deviceIds: string[] = [];
    const loginWith = (auth: AuthManager) => {
      auth.models.login = async (_provider, _type, _interaction, options) => {
        deviceIds.push(options?.getDeviceId?.() ?? "");
        return { type: "oauth", access: "a", refresh: "r", expires: 0 };
      };
      auth.models.refresh = async () => {};
      return auth.loginOAuth("openai", {
        signal: new AbortController().signal,
      } as Parameters<AuthManager["loginOAuth"]>[1]);
    };

    await loginWith(new AuthManager(new EncryptedFileSecretProvider(home)));
    await loginWith(new AuthManager(new EncryptedFileSecretProvider(home)));

    assert.match(deviceIds[0] ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(deviceIds[1], deviceIds[0]);
  });
});
