import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_REFRESH_TOKEN,
  oauthSessions,
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
