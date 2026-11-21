import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installedNamingDiagnostics,
  kindsForUse,
  narrowOrigins,
  originCovers,
  originsWithin,
  scopeUnion,
  settingsSchemaSchema,
  withScopeUnion,
} from "../../src/domains/extensions/index.js";

const github = (over: Record<string, unknown> = {}) => ({
  kind: "gh-device",
  label: "GitHub",
  platform: "github",
  origins: ["https://api.github.com"],
  provider: { type: "oauth2" as const, scopes: ["read:user"] },
  ...over,
});

describe("platform origins", () => {
  it("covers literal origins, wildcard labels and account templates, never widening", () => {
    assert.ok(originCovers("https://api.github.com", "https://api.github.com"));
    assert.ok(
      originCovers("https://*.atlassian.net", "https://acme.atlassian.net"),
    );
    assert.ok(
      originCovers("https://{site}.example.com", "https://a.example.com"),
    );
    assert.ok(originCovers("*", "https://anything.test"));
    assert.ok(!originCovers("https://api.github.com", "https://evil.test"));
    assert.ok(!originCovers("https://*.atlassian.net", "*"));
    assert.ok(!originCovers("https://api.github.com", "http://api.github.com"));
    assert.ok(
      originsWithin(["https://a.test", "https://b.test"], ["https://b.test"]),
    );
    assert.ok(
      !originsWithin(["https://a.test"], ["https://a.test", "https://b.test"]),
    );
  });

  it("narrows the credential origins to what the extension declared and the definition lists", () => {
    const definition = ["https://api.github.com", "https://uploads.github.com"];
    assert.deepEqual(narrowOrigins(definition, undefined), definition);
    assert.deepEqual(narrowOrigins(definition, ["https://api.github.com"]), [
      "https://api.github.com",
    ]);
    assert.deepEqual(narrowOrigins(definition, ["https://evil.test"]), []);
  });
});

describe("platform selection", () => {
  const kinds = [
    github(),
    github({ kind: "other-gh", origins: ["https://github.example.com"] }),
    github({ kind: "gh-token", provider: undefined }),
    { kind: "jira-basic", label: "Jira", platform: "jira" },
  ];

  it("offers every definition of the platform that covers the declared origins", () => {
    const ids = (use: Parameters<typeof kindsForUse>[1]) =>
      kindsForUse(kinds, use).map((kind) => kind.kind);
    assert.deepEqual(ids({ platform: "github" }), [
      "gh-device",
      "other-gh",
      "gh-token",
    ]);
    assert.deepEqual(
      ids({ platform: "github", origins: ["https://api.github.com"] }),
      ["gh-device", "gh-token"],
    );
    assert.deepEqual(ids({ platform: "jira" }), ["jira-basic"]);
    assert.deepEqual(ids({ platform: "gitlab" }), []);
  });

  it("offers a definition that cannot sign in with scopes only to uses without scopes", () => {
    const ids = kindsForUse(kinds, {
      platform: "github",
      scopes: ["repo"],
    }).map((kind) => kind.kind);
    assert.deepEqual(ids, ["gh-device", "other-gh"]);
  });
});

describe("scope union", () => {
  const uses = [
    { platform: "github", scopes: ["repo", "read:user"] },
    { platform: "github", scopes: ["gist"] },
    { platform: "jira", scopes: ["write:jira"] },
  ];

  it("asks for the definition's scopes and those of every extension using the platform", () => {
    assert.deepEqual(scopeUnion(github(), uses.slice(0, 2)), [
      "read:user",
      "repo",
      "gist",
    ]);
    const grown = withScopeUnion(github(), uses);
    assert.deepEqual(
      typeof grown.provider === "object" && grown.provider.scopes,
      ["read:user", "repo", "gist"],
    );
  });

  it("leaves definitions without an oauth2 provider or platform alone", () => {
    const token = github({ provider: undefined });
    assert.equal(withScopeUnion(token, uses), token);
    const plain = github({ platform: undefined });
    assert.equal(withScopeUnion(plain, uses), plain);
  });
});

describe("manifest checks", () => {
  it("rejects a platform setting without a uses entry and a duplicate entry", () => {
    const codes = installedNamingDiagnostics({
      id: "csv-sync",
      uses: [{ platform: "github" }, { platform: "github" }],
      settings: {
        fields: {
          gh: { type: "account", platform: "github" },
          gl: { type: "account", platform: "gitlab" },
        },
      },
    }).map((diagnostic) => diagnostic.code);
    assert.deepEqual(codes, ["platform-use-duplicate", "platform-not-used"]);
  });
});

describe("platform fields in schemas", () => {
  const parse = (field: Record<string, unknown>) =>
    settingsSchemaSchema.safeParse({
      fields: { account: { type: "account", label: "Account", ...field } },
    }).success;

  it("accepts an account field of a kind or of a platform, not both or neither", () => {
    assert.ok(parse({ kind: "jira" }));
    assert.ok(parse({ platform: "github" }));
    assert.ok(!parse({ kind: "jira", platform: "github" }));
    assert.ok(!parse({}));
    assert.ok(!parse({ platform: "Git Hub" }));
  });
});
