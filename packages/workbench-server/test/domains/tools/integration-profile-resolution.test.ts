import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { CapabilitySelection } from "@nervekit/contracts/capabilities";
import { userCapabilitySelection } from "../../../src/domains/capabilities/user-capability-selection.js";
import {
  effectiveIntegrations,
  integrationCredentialProvider,
  integrationProviderConfig,
} from "../../../src/domains/tools/execution/integration-profile-resolution.js";

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
  };
  const selection: CapabilitySelection = {
    disabledTools: [],
    toolProfiles: {
      jira: "jira-work",
      confluence: "docs-work",
      web_search: "search",
    },
    toolSettings: userCapabilitySelection(defaultSettings).toolSettings,
    disabledFileSkills: [],
    enabledNerveSkills: [],
    enabledAgentBrowserSkills: [],
  };
  const integrations = effectiveIntegrations(settings, selection);

  it("resolves each selected credential independently", () => {
    assert.equal(
      integrationCredentialProvider(integrations, "jira"),
      "atlassian:jira-work",
    );
    assert.equal(
      integrationCredentialProvider(integrations, "confluence"),
      "atlassian:docs-work",
    );
    assert.equal(
      integrationCredentialProvider(integrations, "tavily"),
      "tavily:search",
    );
    assert.equal(
      integrationCredentialProvider(integrations, "openai"),
      "openai",
    );
  });

  it("returns provider-specific defaults from the resolved selection", () => {
    assert.deepEqual(integrationProviderConfig(integrations, "jira"), {
      enabled: true,
      siteUrl: "https://jira.atlassian.net",
      email: "jira@example.com",
      defaultProjectKey: "PROJ",
    });
    assert.deepEqual(integrationProviderConfig(integrations, "confluence"), {
      enabled: true,
      siteUrl: "https://docs.atlassian.net",
      email: "docs@example.com",
      defaultSpaceKey: "DOCS",
    });
  });

  it("is enabled by the selection even when the user default is disabled", () => {
    const userDisabled = {
      ...settings,
      tools: {
        ...settings.tools,
        jira: { enabled: false },
      },
    };
    const resolved = effectiveIntegrations(userDisabled, selection);
    assert.equal(resolved.jira.enabled, true);
    assert.equal(integrationProviderConfig(resolved, "jira")?.enabled, true);
  });

  it("fails closed for disabled selections and missing profiles", () => {
    const disabled = effectiveIntegrations(settings, {
      ...selection,
      disabledTools: ["confluence"],
    });
    assert.equal(disabled.confluence.enabled, false);

    const missing = effectiveIntegrations(settings, {
      ...selection,
      toolProfiles: { jira: "missing" },
    });
    assert.equal(missing.jira.enabled, false);
    assert.equal(missing.jira.profileId, "missing");
    assert.equal(integrationCredentialProvider(missing, "jira"), undefined);
    assert.equal(integrationCredentialProvider(missing, "tavily"), undefined);
    assert.deepEqual(integrationProviderConfig(missing, "jira"), {
      enabled: false,
      siteUrl: undefined,
      email: undefined,
      defaultProjectKey: undefined,
    });
  });
});
