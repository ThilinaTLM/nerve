import type { AuthProviderMetadata } from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasChatGptAudioAuth } from "./chatgpt-audio-auth";

function provider(
  patch: Partial<AuthProviderMetadata> & Pick<AuthProviderMetadata, "provider">,
): AuthProviderMetadata {
  return {
    provider: patch.provider,
    displayName: patch.displayName ?? patch.provider,
    supportsApiKey: patch.supportsApiKey ?? true,
    supportsOAuth: patch.supportsOAuth ?? false,
    configured: patch.configured ?? false,
    credentialType: patch.credentialType,
    envVar: patch.envVar,
    oauthName: patch.oauthName,
    warning: patch.warning,
  };
}

describe("ChatGPT audio auth", () => {
  it("requires an OAuth credential for OpenAI Codex", () => {
    assert.equal(
      hasChatGptAudioAuth([
        provider({
          provider: "openai-codex",
          configured: true,
          credentialType: "api_key",
          supportsApiKey: false,
          supportsOAuth: true,
        }),
      ]),
      false,
    );
  });

  it("accepts configured OpenAI Codex OAuth metadata", () => {
    assert.equal(
      hasChatGptAudioAuth([
        provider({
          provider: "openai-codex",
          configured: true,
          credentialType: "oauth",
          supportsApiKey: false,
          supportsOAuth: true,
        }),
      ]),
      true,
    );
  });
});
