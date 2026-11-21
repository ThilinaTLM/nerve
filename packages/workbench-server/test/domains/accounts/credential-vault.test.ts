import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { openCoreStorage, type CoreStorage } from "@nervekit/conversation-core";
import {
  openCredential,
  sealCredential,
  type CredentialBlob,
} from "../../../src/domains/accounts/credential-blob.js";
import {
  CredentialTransientError,
  staticProvider,
  type CredentialProvider,
  type ProviderOutcome,
} from "../../../src/domains/accounts/credential-provider.js";
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

describe("sign-in without typed-in secrets", () => {
  it("keeps the provider state of an account that has no secrets", async () => {
    const storage = openCoreStorage(":memory:");
    open.push(storage);
    const key = randomBytes(32);
    const oauth: AccountKind = { kind: "svc", label: "S", fields: {} };
    const vault = new CredentialVault({
      repository: () => storage.accounts,
      key: async () => key,
      definition: () => oauth,
      provider: () => ({
        ...staticProvider,
        signIn: async () => ({
          status: "ready",
          state: { accessToken: "at" },
          expiresAt: "2026-01-01T01:00:00.000Z",
        }),
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
    await vault.signIn({ id: "a", kind: oauth, fields: {} }, {
      signal: new AbortController().signal,
    } as never);
    const row = storage.accounts.get("a")!;
    assert.equal(row.status, "ready");
    assert.deepEqual(
      openCredential(key, "a", storage.accounts.readCredential("a")!).state,
      {
        accessToken: "at",
      },
    );
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

describe("refresh", () => {
  type FakeState = { access: string; refresh?: string };
  const kind: AccountKind = {
    kind: "svc",
    label: "Service",
    fields: {},
    secret: { label: "Token" },
    auth: { scheme: "bearer" },
  };

  /** A refreshing provider whose `refresh` is scripted by the test. */
  function setup(
    refresh: (state: FakeState) => Promise<ProviderOutcome> | ProviderOutcome,
    options: { required?: string[] } = {},
  ) {
    const storage = openCoreStorage(":memory:");
    open.push(storage);
    const key = randomBytes(32);
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const calls: string[] = [];
    const fake: CredentialProvider = {
      ...staticProvider,
      interactive: true,
      canRefresh: (credential) =>
        Boolean((credential.state as FakeState | undefined)?.refresh),
      requiredScopes: () => options.required ?? [],
      async refresh(_account, credential) {
        const state = credential.state as FakeState;
        calls.push(state.refresh ?? "");
        return await refresh(state);
      },
      async apply(_account, credential) {
        return {
          headers: {
            authorization: `Bearer ${(credential.state as FakeState).access}`,
          },
          query: {},
        };
      },
    };
    const vault = new CredentialVault({
      repository: () => storage.accounts,
      key: async () => key,
      definition: () => kind,
      provider: () => fake,
      now: () => new Date(nowMs),
    });
    const sealed = (id: string, blob: Partial<CredentialBlob>) =>
      sealCredential(key, id, { v: 1, secrets: {}, ...blob });
    const add = (
      id: string,
      options: {
        state?: FakeState;
        expiresInMs?: number | null;
        lastUsedMs?: number | null;
        status?: "ready" | "needs_sign_in" | "failed";
        grantedScopes?: string[];
        name?: string;
      } = {},
    ) => {
      const state = options.state ?? { access: "old", refresh: "r-old" };
      storage.accounts.insert({
        id,
        kind: "svc",
        projectId: null,
        name: options.name ?? id,
        fields: {},
        credential: sealed(id, {
          state,
          ...(options.grantedScopes
            ? { grantedScopes: options.grantedScopes }
            : {}),
        }),
        status: options.status ?? "ready",
        expiresAt:
          options.expiresInMs === null
            ? null
            : new Date(nowMs + (options.expiresInMs ?? 30_000)).toISOString(),
        lastUsedAt:
          options.lastUsedMs === null
            ? null
            : new Date(nowMs - (options.lastUsedMs ?? 1000)).toISOString(),
        createdAt: "x",
        updatedAt: "x",
      });
      return { id, kind, fields: {} };
    };
    const stored = async (id: string) =>
      openCredential(key, id, storage.accounts.readCredential(id)!);
    return {
      vault,
      storage,
      add,
      calls,
      stored,
      advance: (ms: number) => (nowMs += ms),
    };
  }

  const fresh = (access: string, refresh?: string): ProviderOutcome => ({
    status: "ready",
    state: { access, ...(refresh ? { refresh } : {}) },
    expiresAt: "2026-01-01T01:00:00.000Z",
  });

  it("refreshes a token that expires within a minute before using it, writing the row first", async () => {
    const ctx = setup(async () => fresh("new", "r-new"));
    const account = ctx.add("a", { expiresInMs: 30_000 });
    const outcome = await ctx.vault.apply(account, request);
    const writtenBeforeUse = ((await ctx.stored("a")).state as FakeState)
      .access;
    assert.deepEqual(outcome, {
      ok: true,
      headers: { authorization: "Bearer new" },
      query: {},
    });
    assert.equal(writtenBeforeUse, "new");
    assert.equal(
      ctx.storage.accounts.get("a")?.expiresAt,
      "2026-01-01T01:00:00.000Z",
    );
    assert.equal(ctx.storage.accounts.get("a")?.status, "ready");
    // Not due any more: the next use does not refresh again.
    await ctx.vault.apply(account, request);
    assert.equal(ctx.calls.length, 1);
  });

  it("does not refresh a token that is good for more than a minute", async () => {
    const ctx = setup(async () => fresh("new"));
    const account = ctx.add("a", { expiresInMs: 5 * 60_000 });
    const outcome = await ctx.vault.apply(account, request);
    assert.equal(outcome.ok && outcome.headers.authorization, "Bearer old");
    assert.equal(ctx.calls.length, 0);
  });

  it("concurrent requests share one refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ctx = setup(async () => {
      await gate;
      return fresh("new", "r-new");
    });
    const account = ctx.add("a");
    const all = Promise.all([
      ctx.vault.apply(account, request),
      ctx.vault.apply(account, request),
      ctx.vault.apply(account, request),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const results = await all;
    assert.equal(ctx.calls.length, 1);
    for (const result of results)
      assert.equal(result.ok && result.headers.authorization, "Bearer new");
  });

  it("keeps the old refresh token's state when the provider returns it, and the row's other fields", async () => {
    const ctx = setup(async (state) => fresh("new", state.refresh));
    const account = ctx.add("a");
    await ctx.vault.apply(account, request);
    assert.deepEqual((await ctx.stored("a")).state, {
      access: "new",
      refresh: "r-old",
    });
  });

  it("invalid_grant needs sign-in, invalid_client fails with the message; neither is used", async () => {
    const needs = setup(async () => ({
      status: "needs_sign_in",
      message: "Sign in again.",
    }));
    const a = needs.add("a");
    assert.deepEqual(await needs.vault.apply(a, request), {
      ok: false,
      state: "needs_sign_in",
      error: "Sign in again.",
    });
    assert.equal(needs.storage.accounts.get("a")?.status, "needs_sign_in");
    assert.equal((await needs.vault.state("a")).state, "needs_sign_in");
    const failed = setup(async () => ({
      status: "failed",
      message: "Check the client secret.",
    }));
    const b = failed.add("b");
    assert.equal((await failed.vault.apply(b, request)).ok, false);
    assert.deepEqual(await failed.vault.state("b"), {
      state: "failed",
      error: "Check the client secret.",
    });
  });

  it("a transient failure leaves the row unchanged and the request unreachable", async () => {
    const ctx = setup(async () => {
      throw new CredentialTransientError("down");
    });
    const account = ctx.add("a");
    const before = ctx.storage.accounts.readCredential("a");
    const outcome = await ctx.vault.apply(account, request);
    assert.deepEqual(outcome, {
      ok: false,
      state: "unreachable",
      error: "down",
    });
    assert.deepEqual(ctx.storage.accounts.readCredential("a"), before);
    assert.equal(ctx.storage.accounts.get("a")?.status, "ready");
  });

  it("fewer granted scopes than needed need sign-in, on refresh and when read", async () => {
    const ctx = setup(
      async () => ({ ...fresh("new", "r"), grantedScopes: ["read"] }),
      { required: ["read", "write"] },
    );
    const lacking = ctx.add("lacking", {
      expiresInMs: 5 * 60_000,
      grantedScopes: ["read"],
    });
    assert.equal((await ctx.vault.state("lacking")).state, "needs_sign_in");
    assert.equal((await ctx.vault.apply(lacking, request)).ok, false);
    ctx.add("enough", {
      expiresInMs: 5 * 60_000,
      grantedScopes: ["read", "write"],
    });
    assert.equal((await ctx.vault.state("enough")).state, "ready");
    const narrowed = ctx.add("narrowed", {
      expiresInMs: 10_000,
      grantedScopes: ["read", "write"],
    });
    const outcome = await ctx.vault.apply(narrowed, request);
    assert.equal(!outcome.ok && outcome.state, "needs_sign_in");
    assert.equal(ctx.storage.accounts.get("narrowed")?.status, "needs_sign_in");
  });

  it("availability does not refresh: expired with a refresh token is ready, without one needs sign-in", async () => {
    const ctx = setup(async () => fresh("new"));
    ctx.add("with", { expiresInMs: -60_000 });
    ctx.add("without", {
      expiresInMs: -60_000,
      state: { access: "a" },
    });
    assert.equal((await ctx.vault.state("with")).state, "ready");
    assert.equal((await ctx.vault.state("without")).state, "needs_sign_in");
    assert.equal(ctx.calls.length, 0);
    // Used without a refresh token, an expired credential is refused.
    const outcome = await ctx.vault.apply(
      { id: "without", kind, fields: {} },
      request,
    );
    assert.equal(!outcome.ok && outcome.state, "needs_sign_in");
  });

  it("after a 401 refreshes once for requests that began before the last refresh", async () => {
    const ctx = setup(async () => fresh("new", "r-new"));
    const account = ctx.add("a", { expiresInMs: 5 * 60_000 });
    const began = Date.parse("2026-01-01T00:00:00.000Z");
    assert.equal(await ctx.vault.refreshAfterRejection(account, began), true);
    assert.equal(ctx.calls.length, 1);
    // A second request that failed with the same old token reuses the refresh.
    assert.equal(await ctx.vault.refreshAfterRejection(account, began), true);
    assert.equal(ctx.calls.length, 1);
    // One that began after it refreshes again.
    ctx.advance(10_000);
    assert.equal(
      await ctx.vault.refreshAfterRejection(account, began + 10_000),
      true,
    );
    assert.equal(ctx.calls.length, 2);
    // Typed-in secrets have nothing to refresh.
    const typed = fixture(bearer);
    typed.add("t");
    assert.equal(
      await typed.vault.refreshAfterRejection(
        { id: "t", kind: bearer, fields: {} },
        0,
      ),
      false,
    );
  });

  describe("refreshDue", () => {
    it("takes ready accounts expiring within 10 minutes and used within 30 days, one by one", async () => {
      const ctx = setup(async () => fresh("new", "r-new"));
      ctx.add("due", { expiresInMs: 5 * 60_000 });
      ctx.add("later", { expiresInMs: 20 * 60_000 });
      ctx.add("stale", {
        expiresInMs: 5 * 60_000,
        lastUsedMs: 31 * 86_400_000,
      });
      ctx.add("unused", { expiresInMs: 5 * 60_000, lastUsedMs: null });
      ctx.add("broken", { expiresInMs: 5 * 60_000, status: "failed" });
      ctx.add("forever", { expiresInMs: null });
      const noToken = ctx.add("no-token", {
        expiresInMs: 5 * 60_000,
        state: { access: "a" },
      });
      const sweep = await ctx.vault.refreshDue();
      assert.deepEqual(
        { ...sweep, problems: sweep.problems.length },
        { checked: 2, refreshed: 1, skipped: 1, unreachable: 0, problems: 0 },
      );
      assert.equal(ctx.calls.length, 1);
      assert.equal(
        ((await ctx.stored("due")).state as FakeState).access,
        "new",
      );
      assert.equal(
        ((await ctx.stored("later")).state as FakeState).access,
        "old",
      );
      void noToken;
    });

    it("does not touch last_used_at and reports what needs sign-in or failed", async () => {
      const outcomes: ProviderOutcome[] = [
        { status: "needs_sign_in", message: "Revoked." },
        { status: "failed", message: "Bad client." },
        fresh("ok", "r"),
      ];
      const ctx = setup(async () => outcomes.shift()!);
      ctx.add("one", { expiresInMs: 60_000, name: "One" });
      ctx.add("two", { expiresInMs: 120_000, name: "Two" });
      ctx.add("three", { expiresInMs: 180_000, name: "Three" });
      const lastUsed = ctx.storage.accounts.get("one")?.lastUsedAt;
      const sweep = await ctx.vault.refreshDue();
      assert.deepEqual(sweep.problems, [
        {
          id: "one",
          kind: "svc",
          name: "One",
          state: "needs_sign_in",
          error: "Revoked.",
        },
        {
          id: "two",
          kind: "svc",
          name: "Two",
          state: "failed",
          error: "Bad client.",
        },
      ]);
      assert.equal(sweep.refreshed, 1);
      assert.equal(ctx.storage.accounts.get("one")?.lastUsedAt, lastUsed);
      // Neither the refreshed account nor the ones that need sign-in are candidates again.
      assert.equal((await ctx.vault.refreshDue()).checked, 0);
    });

    it("counts network failures as unreachable and stops when aborted", async () => {
      const ctx = setup(async () => {
        throw new CredentialTransientError("down");
      });
      ctx.add("a", { expiresInMs: 60_000 });
      ctx.add("b", { expiresInMs: 90_000 });
      const sweep = await ctx.vault.refreshDue();
      assert.equal(sweep.unreachable, 2);
      assert.equal(sweep.problems.length, 0);
      const controller = new AbortController();
      controller.abort();
      const aborted = await ctx.vault.refreshDue({ signal: controller.signal });
      assert.equal(aborted.unreachable, 0);
      assert.equal(ctx.calls.length, 2);
    });
  });
});
