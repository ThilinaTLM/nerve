import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  providerCommandItems,
  providerSearchKeywords,
} from "./provider-profiles.js";

describe("provider command choices", () => {
  it("groups connected and available providers without changing auth metadata", () => {
    const available = {
      provider: "openai-codex",
      displayName: "OpenAI Codex",
      supportsApiKey: false,
      supportsOAuth: true,
      configured: false,
    };
    const connected = {
      provider: "anthropic",
      displayName: "Anthropic",
      supportsApiKey: true,
      supportsOAuth: true,
      configured: true,
    };
    const items = providerCommandItems([available, connected]);
    assert.deepEqual(
      items.map(({ key, group }) => [key, group]),
      [
        ["anthropic", "Connected"],
        ["openai-codex", "Available"],
      ],
    );
    assert.equal(items[0].provider, connected);
    assert.equal(items[1].provider, available);
    assert.ok(items[1].keywords.some((word) => word.includes("ChatGPT")));
  });

  it("includes ids, display names, family aliases and unknown provider names", () => {
    assert.ok(
      providerSearchKeywords("amazon-bedrock", "Bedrock").includes(
        "Amazon AWS Bedrock",
      ),
    );
    assert.ok(
      providerSearchKeywords("google-gemini-cli", "Gemini CLI").includes(
        "Google Gemini Vertex",
      ),
    );
    assert.deepEqual(providerSearchKeywords("my-server", "Local server"), [
      "my-server",
      "Local server",
      "my server",
    ]);
  });
});
