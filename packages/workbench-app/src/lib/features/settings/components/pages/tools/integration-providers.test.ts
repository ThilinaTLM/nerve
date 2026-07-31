import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEnableIntegration,
  confluenceIntegration,
  integrationConfigurationStatus,
  integrationFieldErrors,
  jiraIntegration,
} from "./integration-providers.js";

describe("normalizeSiteUrl", () => {
  it("adds https and trims trailing slashes", () => {
    assert.equal(
      jiraIntegration.normalizeSiteUrl(" example.atlassian.net/ "),
      "https://example.atlassian.net",
    );
  });

  it("keeps an explicit scheme", () => {
    assert.equal(
      jiraIntegration.normalizeSiteUrl("http://jira.internal"),
      "http://jira.internal",
    );
  });

  it("strips a trailing /wiki for Confluence only", () => {
    assert.equal(
      confluenceIntegration.normalizeSiteUrl(
        "https://example.atlassian.net/wiki",
      ),
      "https://example.atlassian.net",
    );
    assert.equal(
      jiraIntegration.normalizeSiteUrl("https://example.atlassian.net/wiki"),
      "https://example.atlassian.net/wiki",
    );
  });

  it("returns undefined for blank input", () => {
    assert.equal(confluenceIntegration.normalizeSiteUrl("   "), undefined);
  });

  it("rejects malformed and unsupported URLs", () => {
    for (const value of [
      "http://",
      "https://",
      "example atlassian net",
      "ftp://example.atlassian.net",
      "javascript:alert(1)",
      "https://example.atlassian.net?a=1",
      "https://.atlassian.net",
      "single-label-host",
    ]) {
      assert.equal(
        jiraIntegration.normalizeSiteUrl(value),
        undefined,
        `expected ${value} to be rejected`,
      );
    }
  });

  it("accepts localhost and ports for self-hosted instances", () => {
    assert.equal(
      jiraIntegration.normalizeSiteUrl("localhost:8080"),
      "https://localhost:8080",
    );
  });
});

describe("integrationFieldErrors", () => {
  it("reports an invalid site URL", () => {
    const errors = integrationFieldErrors(
      jiraIntegration,
      { siteUrl: "ftp://example.atlassian.net", email: "a@b.co" },
      { tokenConfigured: true },
    );
    assert.ok(errors.siteUrl);
  });

  it("reports an invalid email and a missing token without blocking partial saves", () => {
    const errors = integrationFieldErrors(
      jiraIntegration,
      { siteUrl: "example.atlassian.net", email: "not-an-email", token: "" },
      { tokenConfigured: false },
    );
    assert.ok(errors.email);
    assert.equal(errors.siteUrl, undefined);
    assert.ok(errors.token);
  });

  it("does not require a token when one is already stored", () => {
    assert.deepEqual(
      integrationFieldErrors(
        confluenceIntegration,
        { siteUrl: "", email: "", token: "" },
        { tokenConfigured: true },
      ),
      {},
    );
  });
});

describe("enablement gating", () => {
  it("requires URL, email, and a stored token", () => {
    assert.equal(
      canEnableIntegration({
        siteUrl: "https://example.atlassian.net",
        email: "a@b.co",
        tokenConfigured: true,
      }),
      true,
    );
    assert.equal(
      canEnableIntegration({
        siteUrl: "https://example.atlassian.net",
        email: "a@b.co",
        tokenConfigured: false,
      }),
      false,
    );
    assert.equal(
      canEnableIntegration({ email: "a@b.co", tokenConfigured: true }),
      false,
    );
  });

  it("classifies configuration status", () => {
    assert.equal(
      integrationConfigurationStatus({ tokenConfigured: false }),
      "unconfigured",
    );
    assert.equal(
      integrationConfigurationStatus({
        siteUrl: "https://example.atlassian.net",
        tokenConfigured: false,
      }),
      "incomplete",
    );
    assert.equal(
      integrationConfigurationStatus({
        siteUrl: "https://example.atlassian.net",
        email: "a@b.co",
        tokenConfigured: true,
      }),
      "connected",
    );
  });
});
