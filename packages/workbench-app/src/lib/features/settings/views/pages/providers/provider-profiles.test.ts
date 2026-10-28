import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  providerCommandItems,
  providerSearchKeywords,
  atlassianCredentialId,
  atlassianProfileReady,
  normalizeAtlassianSiteUrl,
  removeAtlassianProfilePatch,
  removeTavilyProfilePatch,
  tavilyCredentialId,
} from "./provider-profiles.js";

describe("provider profile helpers", () => {
  it("normalizes Atlassian URLs and credential ids", () => {
    assert.equal(
      normalizeAtlassianSiteUrl("example.atlassian.net/wiki/"),
      "https://example.atlassian.net",
    );
    assert.equal(atlassianCredentialId("work"), "atlassian:work");
    assert.equal(tavilyCredentialId("search"), "tavily:search");
  });

  it("requires metadata and a configured token", () => {
    const profile = {
      id: "work",
      name: "Work",
      siteUrl: "https://example.atlassian.net",
      email: "user@example.com",
    };
    assert.equal(
      atlassianProfileReady(profile, [
        {
          provider: "atlassian:work",
          displayName: "Atlassian profile",
          supportsApiKey: true,
          supportsOAuth: false,
          configured: true,
          credentialType: "api_key",
        },
      ]),
      true,
    );
    assert.equal(atlassianProfileReady(profile, []), false);
  });

  it("removes only account metadata, leaving scoped agent selections to report missing references", () => {
    const settings = {
      ...defaultSettings,
      providers: {
        atlassianProfiles: [{ id: "work", name: "Work" }],
        tavilyProfiles: [{ id: "search", name: "Search" }],
      },
      tools: {
        ...defaultSettings.tools,
        disabled: [],
        jira: { enabled: true, profileId: "work" },
        confluence: { enabled: true, profileId: "work" },
        web: { tavilyProfileId: "search" },
      },
    };
    const atlassian = removeAtlassianProfilePatch(settings, "work");
    assert.deepEqual(atlassian, { providers: { atlassianProfiles: [] } });
    const tavily = removeTavilyProfilePatch(settings, "search");
    assert.deepEqual(tavily, { providers: { tavilyProfiles: [] } });
  });
});

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
