import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts";
import {
  integrationCredentialProvider,
  integrationProviderConfig,
} from "../src/domains/tools/integration-profile-resolution.js";

describe("integration profile resolution", () => {
  const settings = {
    ...defaultSettings,
    providers: {
      atlassianProfiles: [
        {
          id: "jira-work",
          name: "Jira",
          siteUrl: "https://jira.atlassian.net",
          email: "jira@example.com",
          defaultProjectKey: "PROJ",
        },
        {
          id: "docs-work",
          name: "Docs",
          siteUrl: "https://docs.atlassian.net",
          email: "docs@example.com",
          defaultSpaceKey: "DOCS",
        },
      ],
      tavilyProfiles: [{ id: "search", name: "Search" }],
    },
    tools: {
      ...defaultSettings.tools,
      jira: { enabled: true, profileId: "jira-work" },
      confluence: { enabled: true, profileId: "docs-work" },
      web: { tavilyProfileId: "search" },
    },
  };

  it("resolves each selected credential independently", () => {
    assert.equal(
      integrationCredentialProvider(settings, "jira"),
      "atlassian:jira-work",
    );
    assert.equal(
      integrationCredentialProvider(settings, "confluence"),
      "atlassian:docs-work",
    );
    assert.equal(
      integrationCredentialProvider(settings, "tavily"),
      "tavily:search",
    );
    assert.equal(integrationCredentialProvider(settings, "openai"), "openai");
  });

  it("returns provider-specific defaults and fails closed for missing profiles", () => {
    assert.deepEqual(integrationProviderConfig(settings, "jira"), {
      enabled: true,
      siteUrl: "https://jira.atlassian.net",
      email: "jira@example.com",
      defaultProjectKey: "PROJ",
    });
    assert.deepEqual(integrationProviderConfig(settings, "confluence"), {
      enabled: true,
      siteUrl: "https://docs.atlassian.net",
      email: "docs@example.com",
      defaultSpaceKey: "DOCS",
    });
    const missing = {
      ...settings,
      tools: {
        ...settings.tools,
        jira: { enabled: true, profileId: "missing" },
      },
    };
    assert.equal(integrationCredentialProvider(missing, "jira"), undefined);
    assert.deepEqual(integrationProviderConfig(missing, "jira"), {
      enabled: true,
      siteUrl: undefined,
      email: undefined,
      defaultProjectKey: undefined,
    });
  });
});
