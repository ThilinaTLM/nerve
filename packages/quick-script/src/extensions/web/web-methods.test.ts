import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createSdkEnvironment, findSdkMethod } from "../../runtime/sdk.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 13, 10]);
let dir = "";
let base = "";
let close: () => Promise<void>;
const realFetch = globalThis.fetch;
const tavilyRequests: Array<Record<string, unknown>> = [];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "nerve-web-methods-"));
  const server = createServer((request, response) => {
    if (request.url === "/page") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        "<html><head><title>A &amp; B</title></head><body><h1>Hello</h1><p>World</p></body></html>",
      );
    } else if (request.url === "/data") {
      response.setHeader("content-type", "application/json");
      response.end('{"a":[1,2]}');
    } else if (request.url === "/img") {
      response.setHeader("content-type", "image/png");
      response.end(PNG);
    } else {
      response.statusCode = 404;
      response.end("nope");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  close = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.tavily.com/")) {
      tavilyRequests.push(JSON.parse(String(init?.body)));
      return Response.json({
        results: [
          {
            title: "T",
            url: "https://x.test",
            content: "  some \n text ",
            published_date: "2025-01-02",
          },
          { title: "U", url: "https://y.test", content: "more" },
        ],
      });
    }
    return realFetch(input, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await close();
  await rm(dir, { recursive: true, force: true });
});

function envWith(web: { enabled: boolean; search: boolean } | undefined) {
  return createSdkEnvironment({
    cwd: dir,
    conversationDir: dir,
    web,
    webFetchPolicy: { allowPrivateNetwork: true },
    getApiKey: async (provider) => (provider === "tavily" ? "key" : undefined),
  });
}

async function call(
  name: string,
  args: unknown[],
  env = envWith({ enabled: true, search: true }),
) {
  const prepared = findSdkMethod(name)!.prepare(args, env);
  return { prepared, value: await prepared.run(env), env };
}

void test("web.fetch converts HTML to markdown with its title, authorized as web_fetch with the URL", async () => {
  const { prepared, value } = await call("web.fetch", [`${base}/page`]);
  assert.deepEqual(prepared.authorization, {
    toolName: "web_fetch",
    args: { url: `${base}/page` },
    summary: `${base}/page`,
  });
  const page = value as Record<string, string>;
  assert.equal(page.title, "A & B");
  assert.equal(page.status, 200);
  assert.match(page.contentType, /^text\/html/);
  assert.match(page.content, /# Hello/);
  assert.match(page.content, /World/);
});

void test("web.fetch parses JSON, and as: text keeps the source", async () => {
  const json = (await call("web.fetch", [`${base}/data`])).value as {
    content: unknown;
  };
  assert.deepEqual(json.content, { a: [1, 2] });
  const text = (await call("web.fetch", [{ url: `${base}/data`, as: "text" }]))
    .value as { content: unknown };
  assert.equal(text.content, '{"a":[1,2]}');
  await assert.rejects(
    call("web.fetch", [{ url: `${base}/page`, as: "json" }]),
    /did not return valid JSON/,
  );
});

void test("web.fetch saves binary content as an artifact with exact bytes", async () => {
  const { value, env } = await call("web.fetch", [`${base}/img`]);
  assert.equal(value, "artifact:web-1.png");
  assert.deepEqual(await readFile(join(dir, "quick-script", "web-1.png")), PNG);
  assert.equal(env.report.artifacts.size, 1);
  const named = await call("web.fetch", [
    { url: `${base}/page`, as: "file", name: "p.html" },
  ]);
  assert.equal(named.value, "artifact:p.html");
  await assert.rejects(
    call("web.fetch", [{ url: `${base}/img`, as: "text" }]),
    /use as: "file"/,
  );
});

void test("web.fetch maps HTTP failures to host codes", async () => {
  await assert.rejects(call("web.fetch", [`${base}/missing`]), {
    code: "NOT_FOUND",
  });
});

void test("web.search returns compact hits via Tavily and authorizes as web_search", async () => {
  const { prepared, value } = await call("web.search", [
    { query: "nerve", limit: 2 },
  ]);
  assert.deepEqual(prepared.authorization?.args, {
    query: "nerve",
    max_results: 2,
  });
  assert.deepEqual(value, [
    {
      title: "T",
      url: "https://x.test",
      snippet: "some text",
      published: "2025-01-02",
    },
    { title: "U", url: "https://y.test", snippet: "more" },
  ]);
  assert.equal(tavilyRequests.at(-1)?.max_results, 2);
  assert.equal(tavilyRequests.at(-1)?.api_key, "key");
});

void test("web is refused with the setting to change when disabled or without a Tavily account", () => {
  assert.throws(
    () =>
      findSdkMethod("web.fetch")!.prepare(
        ["https://x.test"],
        envWith(undefined),
      ),
    { code: "DENIED", message: /Settings → Extensions → Web/ },
  );
  const noSearch = envWith({ enabled: true, search: false });
  assert.throws(() => findSdkMethod("web.search")!.prepare(["q"], noSearch), {
    code: "DENIED",
    message: /Tavily account.*Settings → Extensions → Web/,
  });
  assert.doesNotThrow(() =>
    findSdkMethod("web.fetch")!.prepare(["https://x.test"], noSearch),
  );
});
