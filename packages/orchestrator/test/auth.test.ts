import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { AuthManager } from "../src/auth.js";
import { EncryptedFileSecretProvider } from "../src/secrets.js";

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
});
