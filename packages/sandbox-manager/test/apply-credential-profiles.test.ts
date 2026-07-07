import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sandboxConfigV1Schema } from "@nervekit/shared";
import { applyCredentialProfiles } from "../src/config/apply-credential-profiles.js";

const now = new Date().toISOString();

describe("applyCredentialProfiles", () => {
  it("applies Git identity and transport credential profiles", () => {
    const config = {
      version: 1,
      agent: {
        mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      },
    } as const;

    const withProfiles = applyCredentialProfiles(
      config,
      [
        {
          profileId: "git_identity",
          kind: "git",
          providerKind: "git_identity",
          displayName: "Sandbox Bot",
          provider: "git",
          gitAuthorName: "Sandbox Bot",
          gitAuthorEmail: "bot@example.com",
          authType: "none",
          status: "configured",
          secretRefs: [],
          createdAt: now,
          updatedAt: now,
        },
        {
          profileId: "git_token",
          kind: "git",
          providerKind: "git_https_token",
          displayName: "Git HTTPS token",
          provider: "github.com",
          authType: "api_key",
          status: "configured",
          secretRefs: [],
          credential: {
            type: "api_key",
            apiKey: { kv: { key: "credentials/git_token/api-key" } },
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
      {
        sandboxId: "sbx_test",
        managerHttpBaseUrl: "http://127.0.0.1:7869",
      },
    );

    assert.equal(withProfiles.git?.identity?.name, "Sandbox Bot");
    assert.equal(withProfiles.git?.identity?.email, "bot@example.com");
    assert.equal(
      withProfiles.git?.credentials?.git_token?.match?.protocol,
      "https",
    );
    assert.equal(withProfiles.secretStores?.defaultStore, "manager");
  });

  it("maps GitHub profiles to schema-correct GitHub auth and Git transport credentials", () => {
    const config = {
      version: 1,
      agent: {
        mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      },
    } as const;

    const withProfiles = applyCredentialProfiles(
      config,
      [
        {
          profileId: "cred_gh",
          kind: "github",
          providerKind: "github_pat",
          displayName: "GitHub PAT",
          provider: "github.com",
          authType: "api_key",
          status: "configured",
          secretRefs: [],
          credential: {
            type: "api_key",
            apiKey: { kv: { key: "credentials/cred_gh/api-key" } },
          },
          defaultOwner: "acme",
          defaultRepo: "repo",
          createdAt: now,
          updatedAt: now,
        },
      ],
      {
        sandboxId: "sbx_test",
        managerHttpBaseUrl: "http://127.0.0.1:7869",
      },
    );

    assert.deepEqual(withProfiles.github?.auth, {
      type: "pat",
      token: { kv: { key: "credentials/cred_gh/api-key" } },
    });
    assert.equal(
      withProfiles.git?.credentials?.cred_gh?.credential.type,
      "basic",
    );
    assert.doesNotThrow(() =>
      sandboxConfigV1Schema.parse({
        ...withProfiles,
        controller: {
          websocket: { url: "ws://127.0.0.1:7869/api/sandboxes/sbx_test/ws" },
          auth: {
            type: "api_key",
            apiKey: { file: "/secrets/controller-token" },
          },
        },
      }),
    );
  });

  it("injects the manager secret store for model provider credentials inside provider arrays", () => {
    const config = {
      version: 1,
      agent: {
        mainModel: { provider: "openai-codex", model: "gpt-5.1-codex-max" },
      },
    } as const;

    const withProfiles = applyCredentialProfiles(
      config,
      [
        {
          profileId: "cred_model",
          kind: "model_provider",
          providerKind: "openai_codex_oauth",
          displayName: "OpenAI Codex subscription",
          provider: "openai-codex",
          authType: "oauth",
          status: "configured",
          secretRefs: [],
          credential: {
            type: "bearer",
            token: { kv: { key: "credentials/cred_model/oauth-bundle" } },
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
      {
        sandboxId: "sbx_test",
        managerHttpBaseUrl: "http://127.0.0.1:7869",
      },
    );

    assert.equal(withProfiles.secretStores?.defaultStore, "manager");
    assert.equal(withProfiles.secretStores?.stores?.manager?.type, "http_kv");

    assert.doesNotThrow(() =>
      sandboxConfigV1Schema.parse({
        ...withProfiles,
        controller: {
          websocket: { url: "ws://127.0.0.1:7869/api/sandboxes/sbx_test/ws" },
          auth: {
            type: "api_key",
            apiKey: { file: "/secrets/controller-token" },
          },
        },
      }),
    );
  });
});
