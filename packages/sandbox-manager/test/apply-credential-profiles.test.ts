import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sandboxConfigV1Schema } from "@nervekit/shared";
import { applyCredentialProfiles } from "../src/config/apply-credential-profiles.js";

const now = new Date().toISOString();

describe("applyCredentialProfiles", () => {
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
