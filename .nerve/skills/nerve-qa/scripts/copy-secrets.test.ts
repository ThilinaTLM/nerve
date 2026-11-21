import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  openCredential,
  sealCredential,
} from "../../../../packages/workbench-server/src/domains/accounts/credential-blob.js";
import {
  NO_REFRESH_TOKEN,
  oauthSessions,
  readSourceAccounts,
  renameCopied,
  resealAccount,
  selectCopyable,
  type AccountRecord,
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
    "provider:account:tavily:t:apiKey": "acct",
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

const sourceKey = randomBytes(32);
const slotKey = randomBytes(32);
const row = (credential: Buffer | null): AccountRecord => ({
  id: "acc-1",
  kind: "tavily",
  projectId: null,
  name: "Search",
  fields: "{}",
  credential,
  status: "ready",
  expiresAt: null,
  lastUsedAt: null,
  createdAt: "t",
  updatedAt: "t",
});

test("resealAccount moves typed-in secrets to the slot key", () => {
  const sealed = Buffer.from(
    sealCredential(sourceKey, "acc-1", { v: 1, secrets: { secret: "k" } }),
  );
  const next = resealAccount(row(sealed), sourceKey, slotKey);
  assert.equal(next.status, "ready");
  assert.equal(next.droppedState, false);
  assert.deepEqual(
    openCredential(slotKey, "acc-1", next.credential ?? Buffer.alloc(0))
      .secrets,
    { secret: "k" },
  );
});

test("resealAccount drops provider state so no refresh token reaches the slot", () => {
  const sealed = Buffer.from(
    sealCredential(sourceKey, "acc-1", {
      v: 1,
      secrets: {},
      state: { refreshToken: "r" },
    }),
  );
  const next = resealAccount(
    { ...row(sealed), expiresAt: "soon" },
    sourceKey,
    slotKey,
  );
  assert.equal(next.status, "needs_sign_in");
  assert.equal(next.expiresAt, null);
  assert.equal(next.droppedState, true);
  const blob = openCredential(
    slotKey,
    "acc-1",
    next.credential ?? Buffer.alloc(0),
  );
  assert.equal(blob.state, undefined);
});

test("resealAccount marks an unreadable credential as needing sign-in", () => {
  const sealed = Buffer.from(
    sealCredential(randomBytes(32), "acc-1", { v: 1, secrets: {} }),
  );
  const next = resealAccount(row(sealed), sourceKey, slotKey);
  assert.equal(next.credential, null);
  assert.equal(next.status, "needs_sign_in");
});

test("readSourceAccounts converts a pre-0006 home with the migrations' mapping", () => {
  const home = mkdtempSync(join(tmpdir(), "copy-secrets-"));
  try {
    mkdirSync(join(home, "config"));
    writeFileSync(
      join(home, "config", "accounts.json"),
      JSON.stringify({
        profiles: {
          tavily: [{ id: "t1", name: "Search", credential: "tavily:t1" }],
        },
      }),
    );
    const [account, ...rest] = readSourceAccounts(home, sourceKey, {
      "provider:tavily:t1:apiKey": "k",
    });
    assert.equal(rest.length, 0);
    assert.equal(account?.id, "t1");
    assert.equal(account?.status, "ready");
    assert.deepEqual(
      openCredential(sourceKey, "t1", account?.credential ?? Buffer.alloc(0))
        .secrets,
      { secret: "k" },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("renameCopied applies renames and an existing new id wins", () => {
  assert.deepEqual(
    renameCopied({ a: "1", b: "2", c: "3" }, [
      { from: "a", to: "x" },
      { from: "b", to: "c" },
    ]),
    { c: "3", x: "1" },
  );
});
