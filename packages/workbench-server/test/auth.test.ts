import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { AuthManager } from "../src/domains/auth/index.js";
import { EncryptedFileSecretProvider } from "../src/infrastructure/secrets/index.js";

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
  it("stores OAuth credentials and resolves access tokens for subscription providers", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );

    await auth.setOAuth("openai-codex", {
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
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
      expires: Date.now() + 60_000,
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

    const providers = await auth.listProviderMetadata([]);
    const subscriptions = providers
      .filter((provider) => provider.supportsOAuth)
      .map((provider) => provider.provider)
      .sort();

    assert.deepEqual(subscriptions, [
      "anthropic",
      "github-copilot",
      "kimi-coding",
      "openai-codex",
      "openrouter",
      "radius",
      "xai",
    ]);
  });

  it("includes Atlassian provider metadata", async () => {
    const auth = new AuthManager(
      new EncryptedFileSecretProvider(await tempHome()),
    );
    await auth.setApiKey("jira", "jira-token");
    await auth.setApiKey("confluence", "confluence-token");

    const providers = await auth.listProviderMetadata([]);
    const jira = providers.find((provider) => provider.provider === "jira");
    assert.ok(jira);
    assert.equal(jira.displayName, "Jira");
    assert.equal(jira.supportsApiKey, true);
    assert.equal(jira.configured, true);
    const confluence = providers.find(
      (provider) => provider.provider === "confluence",
    );
    assert.ok(confluence);
    assert.equal(confluence.displayName, "Confluence");
    assert.equal(confluence.supportsApiKey, true);
    assert.equal(confluence.configured, true);
    assert.equal(confluence.envVar, "CONFLUENCE_API_TOKEN");
  });
});
