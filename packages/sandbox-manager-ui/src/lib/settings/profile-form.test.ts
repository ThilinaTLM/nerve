import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCredentialProfileWrite,
  type CredentialProfileFormValues,
  parseJsonObject,
  parseStringRecord,
} from "./profile-form";
import type { ProviderOption } from "./provider-catalog";

const baseOption: ProviderOption = {
  providerKind: "anthropic_api_key",
  label: "Anthropic API key",
  detail: "Claude API key.",
  kind: "model_provider",
  provider: "anthropic",
  secretMode: "apiKey",
};

const values: CredentialProfileFormValues = {
  displayName: "  ",
  secretValue: "secret-value",
  siteUrl: "",
  email: "",
  defaultModel: "claude-sonnet-4-5",
  api: "",
  baseUrl: "",
  envJson: '{"ANTHROPIC_ENV":"value"}',
  headersJson: '{"x-header":"value"}',
  compatJson: '{"flag":true}',
  providerOptionsJson: "{}",
  defaultOwner: "",
  defaultRepo: "",
  defaultProjectKey: "",
  defaultSpaceKey: "",
  githubAppId: "",
  githubInstallationId: "",
};

describe("profile form helpers", () => {
  it("parses JSON objects and string records", () => {
    assert.deepEqual(parseJsonObject('{"a":1}', "Test"), { a: 1 });
    assert.deepEqual(parseStringRecord('{"a":"b"}', "Record"), { a: "b" });
    assert.throws(() => parseJsonObject("[]", "Test"), /must be a JSON object/);
    assert.throws(
      () => parseStringRecord('{"a":1}', "Record"),
      /must be a string/,
    );
  });

  it("builds API-key credential profile writes", () => {
    const request = buildCredentialProfileWrite(baseOption, values);
    assert.equal(request.displayName, baseOption.label);
    assert.equal(request.apiKey, "secret-value");
    assert.deepEqual(request.env, { ANTHROPIC_ENV: "value" });
    assert.deepEqual(request.headers, { "x-header": "value" });
    assert.deepEqual(request.compat, { flag: true });
  });

  it("builds OAuth, private-key, and GitHub App secret shapes", () => {
    const oauth = buildCredentialProfileWrite(
      { ...baseOption, secretMode: "oauth", providerKind: "anthropic_oauth" },
      { ...values, secretValue: '{"accessToken":"a"}' },
    );
    assert.deepEqual(oauth.oauthImport, { accessToken: "a" });

    const privateKey = buildCredentialProfileWrite(
      {
        ...baseOption,
        secretMode: "privateKey",
        providerKind: "github_ssh",
        kind: "github",
      },
      values,
    );
    assert.equal(privateKey.privateKey, "secret-value");

    const githubApp = buildCredentialProfileWrite(
      {
        ...baseOption,
        secretMode: "githubApp",
        providerKind: "github_app",
        kind: "github",
      },
      { ...values, githubAppId: " app ", githubInstallationId: " inst " },
    );
    assert.deepEqual(githubApp.githubApp, {
      appId: "app",
      installationId: "inst",
      privateKey: "secret-value",
    });
  });
});
