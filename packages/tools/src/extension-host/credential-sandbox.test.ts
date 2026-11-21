import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { test } from "node:test";
import { sandbox } from "@nervekit/native";
import {
  CREDENTIAL_NEEDS_USER_MESSAGE,
  runCredentialOperation,
  type CredentialHostServices,
  type CredentialOperation,
} from "./credential-sandbox.js";

const skip = !sandbox.isPersistentAvailable();

/** A credentials bundle: the provider is whatever `body` evaluates to. */
const bundle = (body: string) =>
  `globalThis.__nerveCredentialProvider = (${body});`;

const run = (
  source: string,
  operation: CredentialOperation,
  extra: {
    services?: CredentialHostServices;
    state?: unknown;
    secrets?: Record<string, string>;
    limits?: sandbox.SandboxLimits;
    request?: {
      method: string;
      url: string;
      headers: Record<string, string>;
      bodySize: number | null;
    };
  } = {},
) =>
  runCredentialOperation({
    bundle: bundle(source),
    operation,
    account: { id: "a1", kind: "demo-kind", fields: { site: "x" } },
    secrets: extra.secrets ?? { token: "s3cr3t" },
    state: extra.state,
    ...(extra.request ? { request: extra.request } : {}),
    ...(extra.limits ? { limits: extra.limits } : {}),
    services: extra.services ?? {},
  });

const getRequest = {
  method: "GET",
  url: "https://api.test/a?x=1&y=two%20words",
  headers: { accept: "text/plain" },
  bodySize: null,
};

void test(
  "every operation gets a fixed ctx; apply has no network and signIn alone has a UI",
  { skip },
  async () => {
    const keys = `async (ctx) => Object.keys(ctx).sort()`;
    const provider = (op: string) =>
      `{ signIn: ${op === "signIn" ? keys : "async () => ({})"}, refresh: ${op === "refresh" ? keys : "async () => ({})"}, revoke: ${op === "revoke" ? keys : "async () => ({})"}, apply: ${op === "apply" ? keys : "async () => ({})"} }`;
    assert.deepEqual(await run(provider("signIn"), "signIn"), [
      "account",
      "crypto",
      "http",
      "secrets",
      "signal",
      "state",
      "ui",
    ]);
    assert.deepEqual(await run(provider("refresh"), "refresh"), [
      "account",
      "crypto",
      "http",
      "secrets",
      "signal",
      "state",
    ]);
    assert.deepEqual(await run(provider("revoke"), "revoke"), [
      "account",
      "crypto",
      "http",
      "secrets",
      "signal",
      "state",
    ]);
    // `apply` sees no http, no ui, no signal: nothing that reaches outside.
    assert.deepEqual(
      await run(provider("apply"), "apply", { request: getRequest }),
      ["account", "crypto", "request", "secrets", "state"],
    );
  },
);

void test(
  "the sandbox reaches nothing of the host: no host handle, fetch, process or URL",
  { skip },
  async () => {
    const probe = `{ signIn: async () => ({}), apply: async () => ({
      host: typeof globalThis.host, fetch: typeof globalThis.fetch,
      process: typeof globalThis.process, require: typeof globalThis.require,
      url: typeof globalThis.URL, ws: typeof globalThis.WebSocket,
    }) }`;
    assert.deepEqual(await run(probe, "apply", { request: getRequest }), {
      host: "undefined",
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      url: "undefined",
      ws: "undefined",
    });
  },
);

void test(
  "each operation runs in a fresh runtime: no module or global state survives",
  { skip },
  async () => {
    const counter = `(() => { let calls = 0; return {
      signIn: async () => ({}),
      apply: async () => { globalThis.leak = (globalThis.leak ?? 0) + 1; return { calls: ++calls, leak: globalThis.leak }; },
    }; })()`;
    for (let attempt = 0; attempt < 3; attempt++)
      assert.deepEqual(await run(counter, "apply", { request: getRequest }), {
        calls: 1,
        leak: 1,
      });
  },
);

void test(
  "the request parts are given to apply, since the sandbox cannot parse a URL",
  { skip },
  async () => {
    const parts = `{ signIn: async () => ({}), apply: async ({ request }) => ({
      host: request.host, path: request.path, query: request.query, headers: request.headers, body: request.body === undefined,
    }) }`;
    assert.deepEqual(await run(parts, "apply", { request: getRequest }), {
      host: "api.test",
      path: "/a",
      query: [
        ["x", "1"],
        ["y", "two words"],
      ],
      headers: { accept: "text/plain" },
      body: true,
    });
  },
);

void test(
  "crypto is the host's: digests, HMAC and random bytes",
  { skip },
  async () => {
    const out = (await run(
      `{ signIn: async () => ({}), apply: async ({ crypto }) => ({
        sha256: await crypto.hash("sha256", "abc"),
        md5: await crypto.hash("md5", new Uint8Array([97, 98, 99])),
        hmac: await crypto.hmac("sha256", "key", "The quick brown fox jumps over the lazy dog"),
        random: (await crypto.randomBytes(16)).length,
        again: (await crypto.randomBytes(16)).join() !== (await crypto.randomBytes(16)).join(),
      }) }`,
      "apply",
      { request: getRequest },
    )) as Record<string, unknown>;
    const hex = (bytes: unknown) =>
      Buffer.from(bytes as Uint8Array).toString("hex");
    assert.equal(
      hex(out.sha256),
      createHash("sha256").update("abc").digest("hex"),
    );
    assert.equal(hex(out.md5), createHash("md5").update("abc").digest("hex"));
    assert.equal(
      hex(out.hmac),
      createHmac("sha256", "key")
        .update("The quick brown fox jumps over the lazy dog")
        .digest("hex"),
    );
    assert.equal(out.random, 16);
    assert.equal(out.again, true);
  },
);

void test(
  "crypto signs for JWT assertions: RS256, PS256, ES256 (raw r||s) and EdDSA, and refuses a mismatched key",
  { skip },
  async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ed = generateKeyPairSync("ed25519");
    const pem = (key: { export(options: object): string | Buffer }) =>
      key.export({ type: "pkcs8", format: "pem" }).toString();
    const sign = (algorithm: string, privateKey: string) =>
      run(
        `{ signIn: async () => ({}), apply: async ({ crypto }) => crypto.sign({ algorithm: ${JSON.stringify(algorithm)}, privateKey: ${JSON.stringify(privateKey)}, data: "header.payload" }) }`,
        "apply",
        { request: getRequest },
      ) as Promise<Uint8Array>;
    const data = Buffer.from("header.payload");
    const rs = Buffer.from(await sign("RS256", pem(rsa.privateKey)));
    assert.ok(verify("sha256", data, rsa.publicKey, rs));
    const ps = Buffer.from(await sign("PS256", pem(rsa.privateKey)));
    assert.ok(
      verify(
        "sha256",
        data,
        { key: rsa.publicKey, padding: 6, saltLength: 32 },
        ps,
      ),
    );
    const es = Buffer.from(await sign("ES256", pem(ec.privateKey)));
    assert.equal(es.length, 64);
    assert.ok(
      verify(
        "sha256",
        data,
        { key: ec.publicKey, dsaEncoding: "ieee-p1363" },
        es,
      ),
    );
    const eddsa = Buffer.from(await sign("EdDSA", pem(ed.privateKey)));
    assert.ok(verify(null, data, ed.publicKey, eddsa));
    await assert.rejects(sign("ES256", pem(rsa.privateKey)), /needs a EC key/);
    await assert.rejects(sign("RS256", "not a pem"), /not a valid PEM/);
    await assert.rejects(
      sign("HS256", pem(rsa.privateKey)),
      /Unsupported signature/,
    );
  },
);

void test(
  "a provider's errors come back with their code; without services the network and UI are denied",
  { skip },
  async () => {
    await assert.rejects(
      run(
        `{ signIn: async () => { throw new (globalThis.__nerveExtensionApi.ExtensionError)("UNAUTHORIZED", "key rejected"); }, apply: () => ({}) }`,
        "signIn",
      ),
      (error: unknown) =>
        (error as { code?: string }).code === "UNAUTHORIZED" &&
        (error as Error).message === "key rejected",
    );
    await assert.rejects(
      run(
        `{ signIn: async (ctx) => ctx.http.request({ url: "https://a.test/" }), apply: () => ({}) }`,
        "signIn",
      ),
      /no network here/,
    );
    await assert.rejects(
      run(
        `{ signIn: async (ctx) => ctx.ui.askText("Code?"), apply: () => ({}) }`,
        "signIn",
      ),
      (error: unknown) =>
        (error as Error).message === CREDENTIAL_NEEDS_USER_MESSAGE,
    );
  },
);

void test(
  "signIn's UI maps to the host's services; http answers only the provider",
  { skip },
  async () => {
    const shown: unknown[] = [];
    const out = await run(
      `{ signIn: async (ctx) => {
          ctx.ui.progress("Working");
          ctx.ui.showLink("https://login.test/", "Open it");
          ctx.ui.showDeviceCode({ userCode: "ABCD", verificationUri: "https://login.test/device" });
          const choice = await ctx.ui.choose("Which?", [{ id: "a", label: "A" }]);
          const text = await ctx.ui.askText("Name?", { secret: true });
          const listener = await ctx.ui.loopback("st");
          const code = await listener.wait();
          const reply = await ctx.http.request({ url: "https://login.test/token", method: "POST", body: { form: { a: "1" } } });
          return { choice, text, redirect: listener.redirectUri, code, reply };
        }, apply: () => ({}) }`,
      "signIn",
      {
        services: {
          http: async (request) => {
            shown.push(request);
            return {
              status: 200,
              ok: true,
              headers: {},
              body: { access: "t" },
            };
          },
          ui: {
            link: (url, instructions) =>
              void shown.push(["link", url, instructions]),
            deviceCode: (input) => void shown.push(["device", input.userCode]),
            choose: async () => "a",
            askText: async (_message, options) =>
              options?.secret ? "typed" : "?",
            progress: (message) => void shown.push(["progress", message]),
            loopback: async (state) => ({
              redirectUri: `http://127.0.0.1:1/cb?${state}`,
              code: Promise.resolve("the-code"),
            }),
          },
        },
      },
    );
    assert.deepEqual(out, {
      choice: "a",
      text: "typed",
      redirect: "http://127.0.0.1:1/cb?st",
      code: { code: "the-code" },
      reply: { status: 200, ok: true, headers: {}, body: { access: "t" } },
    });
    assert.deepEqual(shown.filter(Array.isArray), [
      ["progress", "Working"],
      ["link", "https://login.test/", "Open it"],
      ["device", "ABCD"],
    ]);
  },
);

void test(
  "limits: a runaway provider is stopped, and an oversized result is refused",
  { skip },
  async () => {
    await assert.rejects(
      run(
        `{ signIn: async () => ({}), apply: () => { for (;;) {} } }`,
        "apply",
        {
          request: getRequest,
          limits: { timeMsPerInvocation: 300 },
        },
      ),
      /credential provider failed/,
    );
    await assert.rejects(
      run(
        `{ signIn: async () => ({}), apply: () => ({ headers: { a: "x".repeat(200000) } }) }`,
        "apply",
        { request: getRequest },
      ),
      /credential provider failed/,
    );
  },
);

void test(
  "body digests come from the host: any algorithm of the list, and the bytes when it allows them",
  { skip },
  async () => {
    const content = Buffer.from("payload");
    const out = (await run(
      `{ signIn: async () => ({}), apply: async ({ request }) => ({
        size: request.body.size,
        sha256: await request.body.digest("sha256"),
        sha1: await request.body.digest("sha1"),
        bytes: await request.body.bytes(),
      }) }`,
      "apply",
      {
        request: { ...getRequest, method: "POST", bodySize: content.length },
        services: {
          body: {
            digest: async (algorithm) =>
              new Uint8Array(createHash(algorithm).update(content).digest()),
            bytes: async () => new Uint8Array(content),
          },
        },
      },
    )) as Record<string, Uint8Array | number>;
    assert.equal(out.size, 7);
    assert.equal(
      Buffer.from(out.sha256 as Uint8Array).toString("hex"),
      createHash("sha256").update(content).digest("hex"),
    );
    assert.equal(Buffer.from(out.bytes as Uint8Array).toString(), "payload");
    // A host that refuses `bytes` (a streamed body) tells the provider why.
    await assert.rejects(
      run(
        `{ signIn: async () => ({}), apply: async ({ request }) => request.body.bytes() }`,
        "apply",
        {
          request: { ...getRequest, method: "PUT", bodySize: 99 },
          services: {
            body: {
              digest: async () => new Uint8Array(),
              bytes: async () => {
                throw new Error("too large to read");
              },
            },
          },
        },
      ),
      /too large to read/,
    );
  },
);
