import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { confluenceDownloadToFile } from "../confluence/client.js";
import { jiraDownloadToFile } from "../jira/client.js";
import { confluenceAttachmentRequest } from "../confluence/client.js";
import { BodyTooLargeError, streamBodyToFile } from "./stream-download.js";

const dir = () => mkdtemp(join(tmpdir(), "stream-dl-"));

function chunked(chunks: number, size: number, signal?: AbortSignal) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (signal?.aborted) return controller.error(signal.reason);
      if (sent++ >= chunks) return controller.close();
      controller.enqueue(new Uint8Array(size).fill(7));
    },
  });
}

async function withFetch<T>(
  handler: (url: URL, init: RequestInit) => Response,
  run: (calls: { url: URL; init: RequestInit }[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    return handler(new URL(String(input)), init);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

void test("streamBodyToFile writes the body and counts bytes", async () => {
  const root = await dir();
  const file = join(root, "out.bin");
  const bytes = await streamBodyToFile(new Response(chunked(4, 1000)), file, {
    maxBytes: 10_000,
  });
  assert.equal(bytes, 4000);
  assert.equal((await readFile(file)).byteLength, 4000);
});

void test("a body over the limit while streaming aborts and leaves no file", async () => {
  const root = await dir();
  await assert.rejects(
    streamBodyToFile(new Response(chunked(10, 1000)), join(root, "out.bin"), {
      maxBytes: 3500,
    }),
    BodyTooLargeError,
  );
  assert.deepEqual(await readdir(root), []);
});

void test("a declared Content-Length over the limit fails before writing", async () => {
  const root = await dir();
  const response = new Response("x", { headers: { "content-length": "9999" } });
  await assert.rejects(
    streamBodyToFile(response, join(root, "out.bin"), { maxBytes: 100 }),
    BodyTooLargeError,
  );
  assert.deepEqual(await readdir(root), []);
});

void test("an abort mid-stream cancels the download and removes the partial file", async () => {
  const root = await dir();
  const controller = new AbortController();
  const pending = streamBodyToFile(
    new Response(chunked(1000, 100, controller.signal)),
    join(root, "out.bin"),
    { maxBytes: 1e9, signal: controller.signal },
  );
  setTimeout(() => controller.abort(new Error("stop")), 20);
  await assert.rejects(pending);
  assert.deepEqual(await readdir(root), []);
});

const confluence = {
  siteUrl: "https://acme.atlassian.net",
  email: "a@b.c",
  token: "secret",
};

void test("Confluence downloads follow the media redirect without credentials", async () => {
  const root = await dir();
  await withFetch(
    (url) =>
      url.hostname === "acme.atlassian.net"
        ? new Response(null, {
            status: 302,
            headers: { location: "https://api.media.atlassian.com/file/1?token=t" },
          })
        : new Response(chunked(3, 10)),
    async (calls) => {
      const bytes = await confluenceDownloadToFile(
        confluence,
        "/download/attachments/1/a.bin",
        { destination: join(root, "a.bin"), maxBytes: 1000 },
      );
      assert.equal(bytes, 30);
      assert.equal(calls.length, 2);
      assert.ok(
        (calls[0].init.headers as Record<string, string>).Authorization,
      );
      assert.equal(calls[1].url.hostname, "api.media.atlassian.com");
      assert.equal(calls[1].init.headers, undefined);
      assert.equal(calls[1].init.redirect, "manual");
    },
  );
});

void test("Confluence downloads refuse a redirect to http", async () => {
  const root = await dir();
  await withFetch(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://evil.example/x" },
      }),
    async (calls) => {
      await assert.rejects(
        confluenceDownloadToFile(confluence, "/download/attachments/1/a", {
          destination: join(root, "a"),
          maxBytes: 1000,
        }),
        /non-https/,
      );
      assert.equal(calls.length, 1);
    },
  );
  assert.deepEqual(await readdir(root), []);
});

void test("an oversize Jira download reports the limit and leaves no file", async () => {
  const root = await dir();
  await withFetch(
    () => new Response(chunked(10, 1000)),
    async () => {
      await assert.rejects(
        jiraDownloadToFile(
          { siteUrl: "https://acme.atlassian.net", email: "a@b.c", token: "t" },
          "9",
          { destination: join(root, "x"), maxBytes: 2500 },
        ),
        (error: { code?: string }) =>
          error.code === "JIRA_ATTACHMENT_TOO_LARGE",
      );
    },
  );
  assert.deepEqual(await readdir(root), []);
});

void test("an upload sends the file from disk as a file-backed part", async () => {
  const root = await dir();
  const path = join(root, "data.bin");
  const content = Buffer.from([1, 2, 3, 4, 5, 250]);
  await writeFile(path, content);
  const { openAsBlob } = await import("node:fs");
  const form = new FormData();
  form.append("file", await openAsBlob(path, { type: "application/zip" }), "data.bin");
  await withFetch(
    () => Response.json({ results: [{ id: "1" }] }),
    async (calls) => {
      await confluenceAttachmentRequest(confluence, {
        parse: (value) => value,
        method: "PUT",
        pageId: "100",
        form,
      });
      const part = (calls[0].init.body as FormData).get("file") as File;
      assert.equal(part.name, "data.bin");
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), content);
    },
  );
});
