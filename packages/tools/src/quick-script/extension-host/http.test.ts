import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createHttp, type HttpHostDeps } from "./http.js";

type Seen = {
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

function deps(over: Partial<HttpHostDeps> = {}): HttpHostDeps {
  const written: { path: string; name: string }[] = [];
  return {
    extensionName: "Test",
    network: [`${base}`],
    kinds: {},
    kindOfField: () => undefined,
    selected: async () => undefined,
    allSelected: async () => [],
    settings: {},
    secret: async () => undefined,
    signal: new AbortController().signal,
    allowPrivateNetwork: true,
    openHandle: async () => {
      throw new Error("no handles");
    },
    artifactSink: () => ({
      prepare: async () => join(await mkdtemp(join(tmpdir(), "http-")), "out"),
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

void test("response.artifactFor streams binary responses and returns textual ones", async () => {
  const { request } = createHttp(deps());
  const binary = await request({
    url: `${base}/binary`,
    response: {
      artifactFor: async (type) =>
        type.startsWith("image/") ? "p.png" : undefined,
    },
  });
  assert.deepEqual(
    (binary.body as { name: string; bytes: number }).name,
    "p.png",
  );
  assert.equal((binary.body as { bytes: number }).bytes, 3);
  const json = await request({
    url: `${base}/json`,
    response: {
      artifactFor: (type) => (type.startsWith("image/") ? "p.png" : undefined),
    },
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
        kindOfField: () => "demo",
        selected: async () => ({
          id: "a",
          name: "A",
          kind: "demo",
          fields: {},
        }),
        secret: async () => "SECRET",
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
        kindOfField: () => "demo",
        selected: async () => ({
          id: "a",
          name: "A",
          kind: "demo",
          fields: {},
        }),
        secret: async () => "SECRET",
      }),
    );
    const response = await request({
      url: `${siteBase}/download/1`,
      auth: { account: "account" },
      response: { artifact: "a.pdf" },
    });
    // 30 MB is beyond the in-memory limit but within the artifact limit.
    assert.equal((response.body as { bytes: number }).bytes, 30 * 1024 * 1024);
    assert.equal(response.headers["content-type"], "application/pdf");
    assert.deepEqual(seenAuth, ["Bearer SECRET", undefined]);
    await assert.rejects(
      request({
        url: `${siteBase}/download/1`,
        auth: { account: "account" },
        response: { artifact: "a.pdf" },
        maxBytes: 1024,
      }),
      /larger than/,
    );
  } finally {
    media.close();
    site.close();
  }
});
