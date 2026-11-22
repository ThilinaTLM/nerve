import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { openCoreStorage, type CoreStorage } from "@nervekit/conversation-core";
import { sandbox } from "@nervekit/native";
import { CredentialTransientError } from "../../../src/domains/accounts/credential-provider.js";
import { CredentialVault } from "../../../src/domains/accounts/credential-vault.js";
import {
  createExtensionCredentialProvider,
  validApplied,
  validIdentity,
  type ExtensionCredentialCode,
} from "../../../src/domains/accounts/extension-credential-provider.js";

const skip = !sandbox.isPersistentAvailable();

const closers: (() => void)[] = [];
const storages: CoreStorage[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const storage of storages.splice(0)) storage.close();
});

async function service(
  answer: (url: string, body: string) => { status?: number; json?: unknown },
) {
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      hits.push(`${request.method} ${request.url}`);
      const reply = answer(request.url ?? "", Buffer.concat(chunks).toString());
      response.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(reply.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
  };
}

const codeFor = (
  source: string,
  operations: ExtensionCredentialCode["operations"] = [
    "signIn",
    "refresh",
    "apply",
    "revoke",
  ],
  sha256 = "a".repeat(64),
): ExtensionCredentialCode => ({
  extensionId: "demo",
  bundle: `globalThis.__nerveCredentialProvider = (${source});`,
  sha256,
  operations,
});

const kindFor = (signInOrigins: string[]): AccountKind => ({
  kind: "demo-account",
  label: "Demo account",
  fields: { site: { type: "string", label: "Site" } },
  secrets: { token: { label: "Token" } },
  provider: "extension",
  signInOrigins,
  origins: ["https://api.test"],
});

const account = (
  kind: AccountKind,
  code: ExtensionCredentialCode,
  fields: Record<string, unknown> = {},
) => ({ id: "a1", kind, fields, credentials: code });

const request = {
  method: "GET",
  url: new URL("https://api.test/items?a=1"),
  headers: { accept: "application/json" },
};

describe("extension credential provider", () => {
  it(
    "signIn: runs the code with the secrets, reaches only its sign-in origins, and returns state, expiry and identity",
    { skip },
    async () => {
      const fake = await service((url, body) => {
        assert.equal(url, "/token");
        assert.match(body, /grant=s3cr3t/);
        return { json: { access: "tok-1", ttl: 3600 } };
      });
      const code = codeFor(`{
      signIn: async (ctx) => {
        const reply = await ctx.http.request({ url: "${fake.base}/token", method: "POST", body: { form: { grant: ctx.secrets.token } } });
        return { state: { access: reply.body.access }, expiresAt: 4102444800000, identity: { login: "octo", bad: "x\\ny", n: 5 }, grantedScopes: ["a", 1] };
      },
      apply: () => ({}),
    }`);
      const kind = kindFor([fake.base]);
      const provider = createExtensionCredentialProvider({
        allowPrivateNetwork: true,
      });
      const outcome = await provider.signIn(account(kind, code), {
        secrets: { token: "s3cr3t" },
      });
      assert.deepEqual(outcome, {
        status: "ready",
        state: { access: "tok-1" },
        expiresAt: "2100-01-01T00:00:00.000Z",
        identity: { login: "octo" },
        grantedScopes: ["a"],
        codeHash: code.sha256,
      });
      assert.deepEqual(fake.hits, ["POST /token"]);
    },
  );

  it(
    "ctx.http refuses an origin outside signInOrigins, never follows a redirect and blocks private addresses unless allowed",
    { skip },
    async () => {
      const other = await service(() => ({ json: { secret: "other" } }));
      const redirecting = await service(() => ({ status: 302 }));
      const code = codeFor(`{
      signIn: async (ctx) => {
        const out = {};
        for (const [name, url] of Object.entries({ other: "${other.base}/x", redirect: "${redirecting.base}/r" })) {
          try { out[name] = (await ctx.http.request({ url })).status; } catch (error) { out[name] = error.code + ": " + error.message; }
        }
        return { state: out };
      },
      apply: () => ({}),
    }`);
      const kind = kindFor([redirecting.base]);
      const open = createExtensionCredentialProvider({
        allowPrivateNetwork: true,
      });
      const outcome = (await open.signIn(account(kind, code), {
        secrets: {},
      })) as {
        state: Record<string, unknown>;
      };
      assert.match(String(outcome.state.other), /^DENIED: .* may not reach/);
      assert.equal(outcome.state.redirect, 302);
      assert.deepEqual(other.hits, []);
      // The SSRF guard applies to a sign-in origin like to any other request.
      const guarded = createExtensionCredentialProvider({});
      const blocked = (await guarded.signIn(account(kind, code), {
        secrets: {},
      })) as {
        state: Record<string, unknown>;
      };
      assert.match(String(blocked.state.redirect), /blocked by host policy/);
    },
  );

  it(
    "signIn without the user needs sign-in when the code wants the UI",
    { skip },
    async () => {
      const code = codeFor(
        `{ signIn: async (ctx) => ({ state: await ctx.ui.askText("Code?") }), apply: () => ({}) }`,
      );
      const outcome = await createExtensionCredentialProvider({}).signIn(
        account(kindFor([]), code),
        { secrets: {} },
      );
      assert.deepEqual(outcome, {
        status: "needs_sign_in",
        message: "Sign in from the Accounts page.",
      });
    },
  );

  it(
    "refresh: needsSignIn is a verdict, a throw is transient, and no refresh operation means sign in again",
    { skip },
    async () => {
      const make = (body: string) =>
        createExtensionCredentialProvider({
          run: async () => {
            if (body === "throw")
              throw new Error("socket hang up: SECRET-DETAIL");
            return JSON.parse(body);
          },
        });
      const code = codeFor("{}");
      const credential = { secrets: {}, state: { access: "old" } };
      assert.deepEqual(
        await make('{"needsSignIn":true,"message":"Key revoked"}').refresh(
          account(kindFor([]), code),
          credential,
        ),
        { status: "needs_sign_in", message: "Key revoked" },
      );
      await assert.rejects(
        make("throw").refresh(account(kindFor([]), code), credential),
        (error: unknown) =>
          error instanceof CredentialTransientError &&
          !/SECRET-DETAIL/.test((error as Error).message),
      );
      const ready = await make(
        '{"state":{"access":"new"},"expiresAt":"2100-01-01T00:00:00Z"}',
      ).refresh(account(kindFor([]), code), credential);
      assert.equal(ready.status, "ready");
      assert.equal(
        (
          await make("{}").refresh(
            account(kindFor([]), codeFor("{}", ["signIn", "apply"])),
            credential,
          )
        ).status,
        "needs_sign_in",
      );
      assert.equal(
        make("{}").canRefresh?.(
          credential,
          account(kindFor([]), codeFor("{}", ["signIn", "apply"])),
        ),
        false,
      );
    },
  );

  it(
    "apply: only adds headers and query parameters; a returned url, method or body changes nothing",
    { skip },
    async () => {
      const code = codeFor(`{
      signIn: async () => ({ state: {} }),
      apply: async ({ request, secrets, state }) => ({
        headers: { Authorization: "Sig " + secrets.token + "/" + state.k, "X-Seen": request.method + request.host },
        query: { sig: "abc" },
        url: "https://evil.test/", method: "DELETE", body: "x", host: "evil.test",
      }),
    }`);
      const applied = await createExtensionCredentialProvider({}).apply(
        account(kindFor([]), code),
        { secrets: { token: "t" }, state: { k: "v" } },
        request,
      );
      assert.deepEqual(applied, {
        headers: { authorization: "Sig t/v", "x-seen": "GETapi.test" },
        query: { sig: "abc" },
      });
    },
  );

  it("apply output is checked: framing headers and control characters are refused", () => {
    for (const bad of [
      { host: "evil.test" },
      { "Content-Length": "0" },
      { "transfer-encoding": "chunked" },
      { "x-a": "line\r\nbreak" },
      { "bad name": "x" },
      { "proxy-authorization": "x" },
    ])
      assert.throws(() => validApplied({ headers: bad }), /not allowed/);
    assert.throws(() => validApplied({ query: { "": "x" } }), /not allowed/);
    assert.deepEqual(validApplied({ headers: { "X-A": "1" }, url: "u" }), {
      headers: { "x-a": "1" },
      query: {},
    });
  });

  it("identity is short plain strings only", () => {
    assert.deepEqual(
      validIdentity({
        login: "octo",
        long: "x".repeat(201),
        ctrl: "a\u0007b",
        num: 3,
        "bad key": "x",
        nested: { a: 1 },
        empty: "",
      }),
      { login: "octo" },
    );
    assert.equal(validIdentity("text"), undefined);
    assert.equal(validIdentity({ a: 1 }), undefined);
  });

  it("revoke runs the code's revoke, best effort", { skip }, async () => {
    const fake = await service(() => ({ json: {} }));
    const code = codeFor(
      `{ signIn: async () => ({ state: {} }), apply: () => ({}), revoke: async (ctx) => { await ctx.http.request({ url: "${fake.base}/revoke", method: "POST", body: ctx.state.refresh }); } }`,
    );
    await createExtensionCredentialProvider({
      allowPrivateNetwork: true,
    }).revoke(account(kindFor([fake.base]), code), {
      secrets: {},
      state: { refresh: "r" },
    });
    assert.deepEqual(fake.hits, ["POST /revoke"]);
  });
});

describe("extension provider in the vault", () => {
  function vaultFor(
    code: () => ExtensionCredentialCode | undefined,
    kind: AccountKind,
  ) {
    const storage = openCoreStorage(":memory:");
    storages.push(storage);
    const key = randomBytes(32);
    const vault = new CredentialVault({
      repository: () => storage.accounts,
      key: async () => key,
      definition: () => kind,
      credentialCode: () => code(),
      extension: { allowPrivateNetwork: true },
    });
    storage.accounts.insert({
      id: "a1",
      kind: kind.kind,
      projectId: null,
      name: "A",
      fields: {},
      createdAt: "x",
      updatedAt: "x",
    });
    return { vault, storage };
  }
  const applyHop = { method: "GET", url: new URL("https://api.test/x") };
  const source = `{
    signIn: async ({ secrets }) => ({ state: { t: secrets.token }, expiresAt: 4102444800000 }),
    apply: async ({ state }) => ({ headers: { authorization: "Bearer " + state.t } }),
  }`;

  it(
    "stores the credential with the code's hash and applies it",
    { skip },
    async () => {
      const code = codeFor(source);
      const { vault, storage } = vaultFor(() => code, kindFor([]));
      const row = {
        id: "a1",
        kind: kindFor([]),
        fields: {},
        credentials: code,
      };
      await vault.saveSecrets(row, { token: "tok" });
      assert.equal(storage.accounts.get("a1")?.status, "ready");
      assert.equal(
        storage.accounts.get("a1")?.expiresAt,
        "2100-01-01T00:00:00.000Z",
      );
      const outcome = await vault.apply(row, applyHop);
      assert.deepEqual(outcome, {
        ok: true,
        headers: { authorization: "Bearer tok" },
        query: {},
      });
    },
  );

  it(
    "a credential written by code that consent no longer covers is not handed to the new code",
    { skip },
    async () => {
      let current = codeFor(source, undefined, "a".repeat(64));
      const { vault } = vaultFor(() => current, kindFor([]));
      const written = {
        id: "a1",
        kind: kindFor([]),
        fields: {},
        credentials: current,
      };
      await vault.saveSecrets(written, { token: "tok" });
      assert.equal((await vault.state("a1")).state, "ready");
      // The extension is updated and the user consented to the new credentials.js.
      current = codeFor(
        source.replace("Bearer", "Token"),
        undefined,
        "b".repeat(64),
      );
      const now = { ...written, credentials: current };
      assert.equal((await vault.state("a1")).state, "needs_sign_in");
      const outcome = await vault.apply(now, applyHop);
      assert.equal(outcome.ok, false);
      assert.equal(!outcome.ok && outcome.state, "needs_sign_in");
    },
  );

  it(
    "a provider that throws in apply fails that request only; the credential stays",
    { skip },
    async () => {
      const code = codeFor(
        `{ signIn: async () => ({ state: {} }), apply: () => { throw new Error("boom with private key"); } }`,
      );
      const { vault, storage } = vaultFor(() => code, kindFor([]));
      const row = {
        id: "a1",
        kind: kindFor([]),
        fields: {},
        credentials: code,
      };
      await vault.saveSecrets(row, { token: "t" });
      const outcome = await vault.apply(row, applyHop);
      assert.equal(!outcome.ok && outcome.state, "failed");
      assert.equal(storage.accounts.get("a1")?.status, "ready");
    },
  );
});
