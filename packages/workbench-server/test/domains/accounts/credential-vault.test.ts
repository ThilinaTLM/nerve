import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { openCoreStorage, type CoreStorage } from "@nervekit/conversation-core";
import {
  openCredential,
  sealCredential,
} from "../../../src/domains/accounts/credential-blob.js";
import { staticProvider } from "../../../src/domains/accounts/credential-provider.js";
import { CredentialVault } from "../../../src/domains/accounts/credential-vault.js";

const open: CoreStorage[] = [];
afterEach(() => {
  for (const storage of open.splice(0)) storage.close();
});

function fixture(kind: AccountKind, available = true) {
  const storage = openCoreStorage(":memory:");
  open.push(storage);
  const key = randomBytes(32);
  let now = new Date("2026-01-01T00:00:00.000Z");
  const vault = new CredentialVault({
    repository: () => storage.accounts,
    key: async () => key,
    definition: () => (available ? kind : undefined),
    now: () => now,
  });
  const add = (id: string, fields: Record<string, unknown> = {}) => {
    storage.accounts.insert({
      id,
      kind: kind.kind,
      projectId: null,
      name: id,
      fields,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    return { id, kind, fields };
  };
  return {
    vault,
    storage,
    key,
    add,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const bearer: AccountKind = {
  kind: "svc",
  label: "Service",
  fields: {},
  secret: { label: "Token" },
  auth: { scheme: "bearer" },
};
const request = { method: "GET", url: new URL("https://svc.test/a") };

describe("credential blob", () => {
  it("is AES-GCM sealed with the account id as associated data", () => {
    const key = randomBytes(32);
    const sealed = sealCredential(key, "acct-1", {
      v: 1,
      secrets: { secret: "hunter2" },
    });
    assert.equal(Buffer.from(sealed).includes("hunter2"), false);
    assert.deepEqual(openCredential(key, "acct-1", sealed).secrets, {
      secret: "hunter2",
    });
    // Moved to another row, opened with another key, or altered: refused.
    assert.throws(() => openCredential(key, "acct-2", sealed));
    assert.throws(() => openCredential(randomBytes(32), "acct-1", sealed));
    const altered = Buffer.from(sealed);
    altered[altered.length - 1] ^= 1;
    assert.throws(() => openCredential(key, "acct-1", altered));
    // Every seal uses a fresh nonce.
    assert.notDeepEqual(
      sealCredential(key, "acct-1", { v: 1, secrets: {} }),
      sealCredential(key, "acct-1", { v: 1, secrets: {} }),
    );
  });
});

describe("CredentialVault", () => {
  it("a blob moved to another row is not handed to the provider", async () => {
    const { vault, storage, add } = fixture(bearer);
    const a = add("a");
    const b = add("b");
    await vault.saveSecrets(a, { secret: "token-a" });
    storage.accounts.writeCredential("b", {
      credential: storage.accounts.readCredential("a"),
      status: "ready",
      expiresAt: null,
      updatedAt: "now",
    });
    assert.equal((await vault.apply(a, request)).ok, true);
    const outcome = await vault.apply(b, request);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.state, "failed");
  });

  it("stores status next to the blob and derives unavailable when the definition is gone", async () => {
    const live = fixture(bearer);
    const account = live.add("a");
    assert.deepEqual(await live.vault.state("a"), { state: "needs_sign_in" });
    await live.vault.saveSecrets(account, { secret: "t" });
    assert.deepEqual(await live.vault.state("a"), { state: "ready" });
    assert.equal(live.storage.accounts.get("a")?.status, "ready");
    const gone = fixture(bearer, false);
    gone.add("a");
    assert.deepEqual(await gone.vault.state("a"), { state: "unavailable" });
    assert.deepEqual(
      await gone.vault.apply({ id: "a", kind: bearer, fields: {} }, request),
      {
        ok: false,
        state: "unavailable",
      },
    );
  });

  it("saving only some secrets keeps the others and waits for the rest", async () => {
    const kind: AccountKind = {
      ...bearer,
      secret: undefined,
      secrets: {
        keyId: { label: "Key id" },
        keySecret: { label: "Key secret" },
      },
      auth: [
        { scheme: "header", name: "X-Key-Id", secret: "keyId" },
        { scheme: "query", name: "sig", secret: "keySecret" },
      ],
    };
    const { vault, add, storage } = fixture(kind);
    const account = add("a");
    await vault.saveSecrets(account, { keyId: "id-1" });
    assert.equal(storage.accounts.get("a")?.status, "needs_sign_in");
    assert.deepEqual((await vault.apply(account, request)).ok, false);
    await vault.saveSecrets(account, { keySecret: "s3" });
    assert.equal(storage.accounts.get("a")?.status, "ready");
    assert.deepEqual(await vault.apply(account, request), {
      ok: true,
      headers: { "x-key-id": "id-1" },
      query: { sig: "s3" },
    });
  });

  it("writes last_used_at on credentialed use, at most once a minute per account", async () => {
    const { vault, add, storage, advance } = fixture(bearer);
    const account = add("a");
    const other = add("b");
    await vault.saveSecrets(account, { secret: "t" });
    await vault.saveSecrets(other, { secret: "t" });
    assert.equal(storage.accounts.get("a")?.lastUsedAt, null);
    await vault.apply(account, request);
    const first = storage.accounts.get("a")?.lastUsedAt;
    assert.equal(first, "2026-01-01T00:00:00.000Z");
    advance(30_000);
    await vault.apply(account, request);
    assert.equal(storage.accounts.get("a")?.lastUsedAt, first);
    // Another account has its own interval.
    await vault.apply(other, request);
    assert.equal(
      storage.accounts.get("b")?.lastUsedAt,
      "2026-01-01T00:00:30.000Z",
    );
    advance(31_000);
    vault.touch("a");
    assert.equal(
      storage.accounts.get("a")?.lastUsedAt,
      "2026-01-01T00:01:01.000Z",
    );
  });

  it("serializes operations per account and lets others run meanwhile", async () => {
    const { vault } = fixture(bearer);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = vault.withLock("a", async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = vault.withLock("a", async () => void order.push("second"));
    await vault.withLock("b", async () => void order.push("other"));
    assert.deepEqual(order, ["first:start", "other"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "other", "first:end", "second"]);
    // A failing operation does not block the next one.
    await assert.rejects(
      vault.withLock("a", async () => Promise.reject(new Error("boom"))),
      /boom/,
    );
    assert.equal(await vault.withLock("a", async () => "ok"), "ok");
  });

  it("reports a provider failure as failed with its message", async () => {
    const storage = openCoreStorage(":memory:");
    open.push(storage);
    const key = randomBytes(32);
    const vault = new CredentialVault({
      repository: () => storage.accounts,
      key: async () => key,
      definition: () => bearer,
      provider: () => ({
        ...staticProvider,
        signIn: async () => Promise.reject(new Error("The service said no")),
      }),
    });
    storage.accounts.insert({
      id: "a",
      kind: "svc",
      projectId: null,
      name: "a",
      fields: {},
      createdAt: "now",
      updatedAt: "now",
    });
    await vault.saveSecrets(
      { id: "a", kind: bearer, fields: {} },
      { secret: "t" },
    );
    assert.deepEqual(await vault.state("a"), {
      state: "failed",
      error: "The service said no",
    });
  });
});

describe("static provider", () => {
  const account = (
    kind: AccountKind,
    fields: Record<string, unknown> = {},
  ) => ({
    id: "a",
    kind,
    fields,
  });
  const apply = (
    kind: AccountKind,
    secrets: Record<string, string>,
    fields: Record<string, unknown> = {},
  ) => staticProvider.apply(account(kind, fields), { secrets }, request);

  it("injects bearer, header, basic and query credentials", async () => {
    assert.deepEqual(await apply(bearer, { secret: "t" }), {
      headers: { authorization: "Bearer t" },
      query: {},
    });
    assert.deepEqual(
      await apply(
        { ...bearer, auth: { scheme: "header", name: "X-Api-Key" } },
        { secret: "t" },
      ),
      { headers: { "x-api-key": "t" }, query: {} },
    );
    assert.deepEqual(
      await apply(
        { ...bearer, auth: { scheme: "basic", user: "email" } },
        { secret: "pw" },
        { email: "a@b.c" },
      ),
      {
        headers: {
          authorization: `Basic ${Buffer.from("a@b.c:pw").toString("base64")}`,
        },
        query: {},
      },
    );
    assert.deepEqual(
      await apply(
        { ...bearer, auth: { scheme: "query", name: "api_key" } },
        { secret: "a b&c" },
      ),
      { headers: {}, query: { api_key: "a b&c" } },
    );
  });

  it("uses several secrets, each by its name", async () => {
    const kind: AccountKind = {
      ...bearer,
      secret: undefined,
      secrets: {
        user: { label: "User" },
        token: { label: "Token", multiline: true },
      },
      auth: [
        { scheme: "basic", user: "ignored", secret: "token" },
        { scheme: "header", name: "X-User", secret: "user" },
        { scheme: "query", name: "u", secret: "user" },
      ],
    };
    assert.deepEqual(await apply(kind, { user: "bob", token: "t" }), {
      headers: {
        authorization: `Basic ${Buffer.from(":t").toString("base64")}`,
        "x-user": "bob",
      },
      query: { u: "bob" },
    });
  });

  it("refuses a missing secret and header values with line breaks", async () => {
    await assert.rejects(apply(bearer, {}), /secret is missing/);
    await assert.rejects(
      apply(bearer, { secret: "a\nb" }),
      /not valid in a header/,
    );
    // A query value may hold anything.
    await apply(
      { ...bearer, auth: { scheme: "query", name: "k" } },
      { secret: "a\nb" },
    );
  });

  it("signs in only with every declared secret present", async () => {
    const two: AccountKind = {
      ...bearer,
      secret: undefined,
      secrets: { a: { label: "A" }, b: { label: "B" } },
      auth: undefined,
    };
    assert.deepEqual(
      await staticProvider.signIn(account(two), { secrets: { a: "1" } }),
      { status: "needs_sign_in", message: "Enter the B." },
    );
    assert.deepEqual(
      await staticProvider.signIn(account(two), {
        secrets: { a: "1", b: "2" },
      }),
      { status: "ready" },
    );
  });
});
