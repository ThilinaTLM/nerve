import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts";
import {
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

  it("clears selected references and disables affected tools", () => {
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
    assert.deepEqual(atlassian.tools?.jira, {
      enabled: false,
      profileId: null,
    });
    assert.deepEqual(atlassian.tools?.confluence, {
      enabled: false,
      profileId: null,
    });
    const tavily = removeTavilyProfilePatch(settings, "search");
    assert.deepEqual(tavily.tools?.web, { tavilyProfileId: null });
    assert.deepEqual(tavily.tools?.disabled, ["web_search"]);
  });
});
