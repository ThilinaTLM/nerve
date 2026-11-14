import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_REFRESH_TOKEN,
  oauthSessions,
  planAccounts,
  renameCopied,
  selectCopyable,
} from "./copy-secrets.ts";

const session = JSON.stringify({
  type: "oauth",
  access: "fixture-access",
  refresh: "fixture-refresh-secret",
  expires: 1_000,
  accountId: "acct",
});

test("selectCopyable keeps api keys and strips refresh tokens from oauth", () => {
  const copy = selectCopyable({
    "provider:tavily:x:apiKey": "k",
    "provider:anthropic:oauth": session,
    "provider:broken:oauth": "not json",
    "installation:deviceId": "id",
  });
  assert.deepEqual(Object.keys(copy).sort(), [
    "provider:anthropic:oauth",
    "provider:tavily:x:apiKey",
  ]);
  const oauth = JSON.parse(copy["provider:anthropic:oauth"] ?? "{}");
  assert.equal(oauth.access, "fixture-access");
  assert.equal(oauth.expires, 1_000);
  assert.equal(oauth.accountId, "acct");
  assert.equal(oauth.refresh, NO_REFRESH_TOKEN);
  assert.ok(!JSON.stringify(copy).includes("fixture-refresh-secret"));
});

test("oauthSessions reports provider and expiry only", () => {
  assert.deepEqual(
    oauthSessions({ "provider:anthropic:oauth": session, x: "y" }),
    [{ provider: "anthropic", expires: 1_000 }],
  );
});

const legacy = {
  profiles: {
    atlassian: [
      { id: "a1", name: "Prod", credential: "atlassian:a1", site: "x" },
    ],
    tavily: [{ id: "t1", name: "Search", credential: "tavily:t1" }],
  },
};

test("planAccounts keeps old format for an unmigrated slot", () => {
  const plan = planAccounts(legacy, {
    profiles: { atlassian: [{ id: "own", name: "Test" }] },
  });
  assert.equal(plan.format, "legacy");
  assert.deepEqual(plan.renames, []);
  const profiles = plan.document.profiles as Record<string, { id: string }[]>;
  assert.deepEqual(
    profiles.atlassian?.map((p) => p.id),
    ["a1", "own"],
  );
});

test("planAccounts converts old production accounts for a v2 slot with the migration's mapping", () => {
  const plan = planAccounts(legacy, {
    version: 2,
    accounts: {
      atlassian: [{ id: "a1", name: "Stale", fields: {} }],
      other: [{ id: "o", name: "O", fields: {} }],
    },
  });
  assert.equal(plan.format, "v2");
  assert.equal(plan.document.version, 2);
  assert.ok(!("profiles" in plan.document));
  const accounts = plan.document.accounts as Record<
    string,
    { id: string; name: string; fields: unknown }[]
  >;
  assert.equal(accounts.atlassian?.[0]?.name, "Prod");
  assert.deepEqual(accounts.atlassian?.[0]?.fields, { site: "x" });
  assert.equal(accounts.other?.length, 1);
  assert.deepEqual(plan.renames, [
    {
      from: "provider:atlassian:a1:apiKey",
      to: "provider:account:atlassian:a1:apiKey",
    },
    {
      from: "provider:tavily:t1:apiKey",
      to: "provider:account:tavily:t1:apiKey",
    },
  ]);
  const secrets = renameCopied(
    { "provider:atlassian:a1:apiKey": "k", "provider:openai:apiKey": "o" },
    plan.renames,
  );
  assert.deepEqual(Object.keys(secrets).sort(), [
    "provider:account:atlassian:a1:apiKey",
    "provider:openai:apiKey",
  ]);
});

test("planAccounts copies v2 production as is and refuses v2 into an unmigrated slot", () => {
  const v2 = {
    version: 2,
    accounts: { tavily: [{ id: "t", name: "T", fields: {} }] },
  };
  assert.deepEqual(planAccounts(v2, undefined).document, v2);
  assert.throws(() => planAccounts(v2, legacy), /migration 0005/);
});
