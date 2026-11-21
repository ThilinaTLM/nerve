import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
import {
  createHttp,
  MAX_CREDENTIAL_BODY_BYTES,
  type HttpHostDeps,
} from "./http.js";

type Seen = {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};
let server: Server;
let base = "";
const seen: Seen[] = [];

before(async () => {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- reads the body first
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    seen.push({
      url: request.url ?? "",
      method: request.method ?? "",
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    if (request.url === "/binary") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([1, 2, 3]));
    } else if (request.url === "/json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"a":1}');
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());

/** A stand-in for the vault: a ready account whose credential is a bearer token. */
function bearerCredential(
  secret: string | undefined,
): HttpHostDeps["credential"] {
  return {
    state: async () => (secret ? "ready" : "needs_sign_in"),
    apply: async () =>
      secret
        ? {
            ok: true,
            headers: { authorization: `Bearer ${secret}` },
            query: {},
          }
        : { ok: false, state: "needs_sign_in" },
  };
}

function deps(over: Partial<HttpHostDeps> = {}): HttpHostDeps {
  const written: { path: string; name: string }[] = [];
  return {
    extensionName: "Test",
    network: [`${base}`],
    kinds: {},
    kindsOfField: () => [],
    selected: async () => undefined,
    allSelected: async () => [],
    settings: {},
    credential: bearerCredential(undefined),
    signal: new AbortController().signal,
    allowPrivateNetwork: true,
    openHandle: async () => {
      throw new Error("no handles");
    },
    artifactSink: () => ({
      prepare: async () => join(await mkdtemp(join(tmpdir(), "http-")), "out"),
      freshName: async (name, extension) => `${name}-1${extension}`,
      commit: async (path, name) => {
        written.push({ path, name });
        return {
          handle: `artifact:${name}`,
          name,
          bytes: (await stat(path)).size,
          mediaType: "image/png",
        };
      },
    }),
    ...over,
  };
}

void test("a multipart file handle is streamed by the host, beyond the in-memory limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "http-file-"));
  const path = join(dir, "big.bin");
  const size = 22 * 1024 * 1024;
  const content = Buffer.alloc(size, 7);
  await writeFile(path, content);
  const { request } = createHttp(
    deps({ openHandle: async () => ({ path, size }) }),
  );
  seen.length = 0;
  const response = await request({
    url: `${base}/upload`,
    method: "POST",
    body: {
      form: [
        { name: "comment", value: "hi" },
        {
          name: "file",
          filename: 'a "b".bin',
          mediaType: "application/x-test",
          data: { handle: "artifact:big.bin" },
        },
      ],
    },
  });
  assert.equal(response.status, 200);
  const [call] = seen;
  assert.match(
    String(call.headers["content-type"]),
    /^multipart\/form-data; boundary=/,
  );
  assert.equal(Number(call.headers["content-length"]), call.body.length);
  const text = call.body.toString("latin1");
  assert.match(text, /name="comment"\r\n\r\nhi\r\n/);
  assert.match(
    text,
    /name="file"; filename="a %22b%22.bin"\r\nContent-Type: application\/x-test\r\n\r\n/,
  );
  const start =
    call.body.indexOf("\r\n\r\n", call.body.indexOf('name="file"')) + 4;
  assert.ok(call.body.subarray(start, start + size).equals(content));
});

void test("response artifact with inlineText streams binary responses and returns textual ones", async () => {
  const { request } = createHttp(deps());
  const binary = await request({
    url: `${base}/binary`,
    response: "artifact",
    artifact: { baseName: "pic", inlineText: true },
  });
  assert.equal((binary.body as { name: string }).name, "pic-1.png");
  assert.equal((binary.body as { bytes: number }).bytes, 3);
  const json = await request({
    url: `${base}/json`,
    response: "artifact",
    artifact: { baseName: "pic", inlineText: true },
  });
  assert.equal(json.body, '{"a":1}');
});

// Jira's media id: a HEAD to the attachment content URL follows Atlassian's redirect to the signed media URL.
void test("a redirect to another allowed origin drops the credential, reports the final URL and does not blame the account for the media host's status", async () => {
  const auth: (string | undefined)[] = [];
  const media = createServer((request, response) => {
    auth.push(request.headers.authorization);
    response.writeHead(request.url?.includes("denied") ? 403 : 200);
    response.end();
  });
  await new Promise<void>((resolve) => media.listen(0, "127.0.0.1", resolve));
  const mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const site = createServer((request, response) => {
    auth.push(`site:${request.method}:${request.headers.authorization}`);
    response.writeHead(303, {
      location: `${mediaBase}/file/${uuid}/binary?token=${request.url?.includes("denied") ? "denied" : "x"}`,
    });
    response.end();
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const siteBase = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  try {
    const { request } = createHttp(
      deps({
        network: [siteBase, mediaBase],
        kinds: {
          demo: {
            label: "Demo account",
            auth: { scheme: "bearer" },
            origins: [siteBase],
          },
        },
        kindsOfField: () => ["demo"],
        selected: async () => ({
          id: "a",
          name: "A",
          kind: "demo",
          fields: {},
          level: "user",
        }),
        credential: bearerCredential("SECRET"),
      }),
    );
    for (const path of ["attachment/1", "attachment/denied"]) {
      auth.length = 0;
      const response = await request({
        url: `${siteBase}/rest/api/3/${path}`,
        method: "HEAD",
        auth: { account: "account" },
        response: "text",
      });
      assert.match(response.url, new RegExp(`/file/${uuid}/binary\\?token=`));
      assert.equal(response.status, path.endsWith("denied") ? 403 : 200);
      assert.deepEqual(auth, ["site:HEAD:Bearer SECRET", undefined]);
    }
  } finally {
    media.close();
    site.close();
  }
});

void test("an attachment download follows the redirect without the credential and streams to an artifact, up to the limit", async () => {
  const seenAuth: (string | undefined)[] = [];
  const media = createServer((request, response) => {
    seenAuth.push(request.headers.authorization);
    response.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="a.pdf"',
    });
    response.end(Buffer.alloc(30 * 1024 * 1024, 1));
  });
  await new Promise<void>((resolve) => media.listen(0, "127.0.0.1", resolve));
  const mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
  const site = createServer((request, response) => {
    seenAuth.push(request.headers.authorization);
    response.writeHead(302, { location: `${mediaBase}/dl` });
    response.end();
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const siteBase = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  try {
    const { request } = createHttp(
      deps({
        network: [siteBase, mediaBase],
        kinds: {
          demo: {
            label: "Demo account",
            auth: { scheme: "bearer" },
            origins: [siteBase],
          },
        },
        kindsOfField: () => ["demo"],
        selected: async () => ({
          id: "a",
          name: "A",
          kind: "demo",
          fields: {},
          level: "user",
        }),
        credential: bearerCredential("SECRET"),
      }),
    );
    const response = await request({
      url: `${siteBase}/download/1`,
      auth: { account: "account" },
      response: "artifact",
      artifact: { name: "a.pdf" },
    });
    // 30 MB is beyond the in-memory limit but within the artifact limit.
    assert.equal((response.body as { bytes: number }).bytes, 30 * 1024 * 1024);
    assert.equal(response.headers["content-type"], "application/pdf");
    assert.deepEqual(seenAuth, ["Bearer SECRET", undefined]);
    await assert.rejects(
      request({
        url: `${siteBase}/download/1`,
        auth: { account: "account" },
        response: "artifact",
        artifact: { name: "a.pdf" },
        maxBytes: 1024,
      }),
      /larger than/,
    );
  } finally {
    media.close();
    site.close();
  }
});

void test("a query credential is added for the credential origin only and never shows in the result", async () => {
  const applied: string[] = [];
  const { request } = createHttp(
    deps({
      kinds: {
        demo: {
          label: "Demo account",
          auth: { scheme: "query", name: "api_key" },
          origins: [base],
        },
      },
      kindsOfField: () => ["demo"],
      selected: async () => ({
        id: "a",
        name: "A",
        kind: "demo",
        fields: {},
        level: "user",
      }),
      credential: {
        state: async () => "ready",
        apply: async (_kind, _id, hop) => {
          applied.push(`${hop.method} ${hop.url.pathname}`);
          return { ok: true, headers: {}, query: { api_key: "S3 CRET&" } };
        },
      },
    }),
  );
  seen.length = 0;
  const response = await request({
    url: `${base}/json?q=1`,
    auth: { account: "account" },
  });
  assert.deepEqual(applied, ["GET /json"]);
  const url = new URL(seen[0].url, base);
  assert.equal(url.searchParams.get("q"), "1");
  assert.equal(url.searchParams.get("api_key"), "S3 CRET&");
  assert.doesNotMatch(response.url, /api_key|CRET/);
});

void test("an account that needs sign-in fails the request before anything is sent", async () => {
  const { request } = createHttp(
    deps({
      kinds: {
        demo: {
          label: "Demo account",
          auth: { scheme: "bearer" },
          origins: [base],
        },
      },
      kindsOfField: () => ["demo"],
      selected: async () => ({
        id: "a",
        name: "A",
        kind: "demo",
        fields: {},
        level: "user",
      }),
      credential: bearerCredential(undefined),
    }),
  );
  seen.length = 0;
  await assert.rejects(
    request({ url: `${base}/json`, auth: { account: "account" } }),
    /needs sign-in/,
  );
  assert.equal(seen.length, 0);
});

async function authServer(accept: string) {
  const attempts: { auth?: string; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      attempts.push({
        ...(request.headers.authorization
          ? { auth: request.headers.authorization }
          : {}),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const ok = request.headers.authorization === accept;
      response.writeHead(ok ? 200 : 401, {
        "content-type": "application/json",
      });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { attempts, origin, close: () => server.close() };
}

function oauthDeps(
  origin: string,
  credential: HttpHostDeps["credential"],
): HttpHostDeps {
  return deps({
    network: [origin],
    kinds: {
      demo: { label: "Demo", auth: { scheme: "bearer" }, origins: [origin] },
    },
    kindsOfField: () => ["demo"],
    selected: async () => ({
      id: "a",
      name: "A",
      kind: "demo",
      fields: {},
      level: "user",
    }),
    credential,
  });
}

void test("a 401 refreshes the credential and retries the request once, with its body", async () => {
  const service = await authServer("Bearer fresh");
  try {
    let token = "stale";
    const refreshes: number[] = [];
    const { request } = createHttp(
      oauthDeps(service.origin, {
        state: async () => "ready",
        apply: async () => ({
          ok: true,
          headers: { authorization: `Bearer ${token}` },
          query: {},
        }),
        refreshAfterRejection: async (_kind, _id, startedAt) => {
          refreshes.push(startedAt);
          token = "fresh";
          return true;
        },
      }),
    );
    const response = await request({
      url: `${service.origin}/x`,
      method: "POST",
      body: { json: { a: 1 } },
      auth: { account: "account" },
    });
    assert.equal(response.status, 200);
    assert.equal(refreshes.length, 1);
    assert.deepEqual(
      service.attempts.map((attempt) => [attempt.auth, attempt.body]),
      [
        ["Bearer stale", '{"a":1}'],
        ["Bearer fresh", '{"a":1}'],
      ],
    );
  } finally {
    service.close();
  }
});

void test("a second 401 is the account's error, and nothing refreshes when it cannot", async () => {
  const service = await authServer("Bearer never");
  try {
    let refreshes = 0;
    const credential = (refreshed: boolean): HttpHostDeps["credential"] => ({
      state: async () => "ready",
      apply: async () => ({
        ok: true,
        headers: { authorization: "Bearer stale" },
        query: {},
      }),
      refreshAfterRejection: async () => {
        refreshes += 1;
        return refreshed;
      },
    });
    await assert.rejects(
      createHttp(oauthDeps(service.origin, credential(true))).request({
        url: `${service.origin}/x`,
        auth: { account: "account" },
      }),
      /rejected the credential/,
    );
    assert.equal(refreshes, 1);
    assert.equal(service.attempts.length, 2);
    service.attempts.length = 0;
    await assert.rejects(
      createHttp(oauthDeps(service.origin, credential(false))).request({
        url: `${service.origin}/x`,
        auth: { account: "account" },
      }),
      /rejected the credential/,
    );
    assert.equal(service.attempts.length, 1);
  } finally {
    service.close();
  }
});

void test("a credential that cannot be refreshed because the service is unreachable fails the request as a server error", async () => {
  const { request } = createHttp(
    oauthDeps(base, {
      state: async () => "ready",
      apply: async () => ({ ok: false, state: "unreachable" }),
    }),
  );
  await assert.rejects(
    request({ url: `${base}/json`, auth: { account: "account" } }),
    (error: unknown) =>
      (error as { code?: string }).code === "SERVER_ERROR" &&
      /unreachable/.test((error as Error).message),
  );
});

void test("a platform definition's credential goes only to the origins both it and the using extension list", async () => {
  const using = (useOrigins: string[]) =>
    createHttp(
      deps({
        kinds: {
          "other-github": {
            label: "GitHub account",
            auth: { scheme: "bearer" },
            origins: [base],
            useOrigins,
          },
        },
        kindsOfField: () => ["other-github"],
        selected: async () => ({
          id: "a",
          name: "A",
          kind: "other-github",
          fields: {},
          level: "user",
        }),
        credential: bearerCredential("tok"),
      }),
    ).request;
  seen.length = 0;
  await using([base])({ url: `${base}/json`, auth: { account: "account" } });
  assert.equal(seen[0].headers.authorization, "Bearer tok");
  // An origin the definition does not list narrows to nothing: the extension cannot widen it.
  await assert.rejects(
    using(["https://api.example.com"])({
      url: `${base}/json`,
      auth: { account: "account" },
    }),
    /is not sent to/,
  );
});

function spyCredential(
  onApply: (
    request: Parameters<HttpHostDeps["credential"]["apply"]>[2],
  ) => ReturnType<HttpHostDeps["credential"]["apply"]>,
): HttpHostDeps["credential"] {
  return { state: async () => "ready", apply: async (_k, _i, r) => onApply(r) };
}

const demoKind = (origin: string) => ({
  network: [origin],
  kinds: {
    demo: {
      label: "Demo",
      auth: { scheme: "bearer" } as const,
      origins: [origin],
    },
  },
  kindsOfField: () => ["demo"],
  selected: async () => ({
    id: "a",
    name: "A",
    kind: "demo",
    fields: {},
    level: "user" as const,
  }),
});

void test("a credential provider gets digests of the body, also of a file-streamed upload, and bytes only up to the limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "http-cred-"));
  const small = join(dir, "small.bin");
  const big = join(dir, "big.bin");
  await writeFile(small, Buffer.alloc(1024, 3));
  const bigSize = MAX_CREDENTIAL_BODY_BYTES + 1;
  await writeFile(big, Buffer.alloc(bigSize, 5));
  const inspected: {
    size: number | undefined;
    sha256: string;
    sha1: string;
    bytes: number | string;
  }[] = [];
  const upload = async (file: string, size: number) => {
    seen.length = 0;
    const { request } = createHttp(
      deps({
        ...demoKind(base),
        openHandle: async () => ({ path: file, size }),
        credential: spyCredential(async (hop) => {
          const body = hop.body!;
          const sha256 = Buffer.from(await body.digest("sha256")).toString(
            "hex",
          );
          const sha1 = Buffer.from(await body.digest("sha1")).toString("hex");
          // Asked twice, computed once: the same answer.
          assert.equal(
            Buffer.from(await body.digest("sha256")).toString("hex"),
            sha256,
          );
          const bytes = await body.bytes().then(
            (value) => value.byteLength,
            (error: Error) => error.message,
          );
          inspected.push({ size: body.size, sha256, sha1, bytes });
          return { ok: true, headers: {}, query: {} };
        }),
      }),
    );
    await request({
      url: `${base}/upload`,
      method: "POST",
      auth: { account: "account" },
      body: {
        form: [
          { name: "file", filename: "f.bin", data: { handle: "artifact:f" } },
        ],
      },
    });
    return seen[0].body;
  };
  const smallWire = await upload(small, 1024);
  const bigWire = await upload(big, bigSize);
  // The digest is of exactly what went on the wire (multipart framing included).
  for (const [entry, wire] of [
    [inspected[0], smallWire],
    [inspected[1], bigWire],
  ] as const) {
    assert.equal(entry.size, wire.length);
    assert.equal(entry.sha256, createHash("sha256").update(wire).digest("hex"));
    assert.equal(entry.sha1, createHash("sha1").update(wire).digest("hex"));
  }
  assert.equal(inspected[0].bytes, smallWire.length);
  assert.match(String(inspected[1].bytes), /larger than 20 MiB.*digest\(\)/);

  // A buffered JSON body: digest and bytes agree.
  let buffered: Uint8Array | undefined;
  const { request } = createHttp(
    deps({
      ...demoKind(base),
      credential: spyCredential(async (hop) => {
        buffered = await hop.body!.bytes();
        assert.equal(
          Buffer.from(await hop.body!.digest("md5")).toString("hex"),
          createHash("md5").update(buffered).digest("hex"),
        );
        return { ok: true, headers: {}, query: {} };
      }),
    }),
  );
  await request({
    url: `${base}/json`,
    method: "POST",
    auth: { account: "account" },
    body: { json: { a: 1 } },
  });
  assert.equal(Buffer.from(buffered!).toString(), '{"a":1}');
  // No body, no handle.
  let hadBody: boolean | undefined;
  const bodyless = createHttp(
    deps({
      ...demoKind(base),
      credential: spyCredential(async (hop) => {
        hadBody = hop.body !== undefined;
        return { ok: true, headers: {}, query: {} };
      }),
    }),
  );
  await bodyless.request({ url: `${base}/json`, auth: { account: "account" } });
  assert.equal(hadBody, false);
});

void test("apply output goes only to the credential origin: a redirect to another origin gets none and apply is not asked", async () => {
  const elsewhere = createServer((request, response) => {
    seenElsewhere.push(String(request.headers.authorization));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const seenElsewhere: string[] = [];
  await new Promise<void>((resolve) =>
    elsewhere.listen(0, "127.0.0.1", resolve),
  );
  const other = `http://localhost:${(elsewhere.address() as AddressInfo).port}`;
  const origin = createServer((_request, response) => {
    response.writeHead(302, { location: `${other}/landing` });
    response.end();
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  const home = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
  try {
    const asked: string[] = [];
    const { request } = createHttp(
      deps({
        ...demoKind(home),
        network: [home, other],
        credential: spyCredential(async (hop) => {
          asked.push(hop.url.origin);
          return {
            ok: true,
            headers: { authorization: "Bearer SIGNATURE" },
            query: { sig: "SECRET" },
          };
        }),
      }),
    );
    const response = await request({
      url: `${home}/start`,
      auth: { account: "account" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(asked, [new URL(home).origin]);
    assert.deepEqual(seenElsewhere, ["undefined"]);
    // Nothing the provider produced comes back to the backend.
    assert.doesNotMatch(JSON.stringify(response), /SIGNATURE|SECRET/);
  } finally {
    origin.close();
    elsewhere.close();
  }
});

void test("a failing apply fails the request with a fixed message, never the provider's text", async () => {
  const { request } = createHttp(
    deps({
      ...demoKind(base),
      credential: spyCredential(async () => ({
        ok: false,
        state: "failed",
        error: "private key -----BEGIN PRIVATE KEY----- leaked",
      })),
    }),
  );
  seen.length = 0;
  await assert.rejects(
    request({ url: `${base}/json`, auth: { account: "account" } }),
    (error: unknown) => {
      const text = JSON.stringify({
        message: (error as Error).message,
        fix: (error as { fix?: string }).fix,
      });
      assert.match(text, /has a credential that does not work/);
      assert.doesNotMatch(text, /PRIVATE KEY|leaked/);
      return true;
    },
  );
  assert.equal(seen.length, 0);
});
