import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpRequest, HttpResponse } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { webMethods } from "./web-methods.js";
import { webExtension } from "./manifest.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 13, 10]);
const text = (value: string) => new TextEncoder().encode(value);
const reply = (
  body: unknown,
  type: string,
  status = 200,
  url = "https://site.test/x",
): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { "content-type": type },
  url,
  body,
});

const pages: Record<string, HttpResponse> = {
  "https://site.test/page": reply(
    text(
      "<html><head><title>A &amp; B</title></head><body><h1>Hello</h1><p>World</p></body></html>",
    ),
    "text/html; charset=utf-8",
    200,
    "https://site.test/page",
  ),
  "https://site.test/data": reply(text('{"a":[1,2]}'), "application/json"),
  "https://site.test/img": reply(PNG, "image/png"),
  "https://site.test/missing": reply(text("nope"), "text/plain", 404),
};

function setup(account = true) {
  const tavily: HttpRequest[] = [];
  const fake = createFakeContext({
    accounts: account
      ? {
          searchAccount: {
            id: "t1",
            name: "T",
            kind: "tavily",
            fields: {},
          },
        }
      : {},
    htmlToMarkdown: (html) =>
      html.replace(/<h1>(.*?)<\/h1>/, "# $1\n\n").replace(/<[^>]+>/g, ""),
    http: (request) => {
      if (request.url === "https://api.tavily.com/search") {
        tavily.push(request);
        return reply(
          JSON.stringify({
            results: [
              {
                title: "T",
                url: "https://x.test",
                content: "  some \n text ",
                published_date: "2025-01-02",
              },
              { title: "U", url: "https://y.test", content: "more" },
            ],
          }),
          "application/json",
        );
      }
      return pages[request.url] ?? reply(text("nope"), "text/plain", 404);
    },
  });
  return { ...fake, tavily };
}

const fetchPage = (
  ctx: ReturnType<typeof setup>["ctx"],
  ...args: unknown[]
) => {
  const input = webMethods.fetch.parse(args);
  return {
    authorization: webMethods.fetch.authorize?.(input),
    run: async () => await webMethods.fetch.run(undefined, input, ctx),
  };
};

void test("web.fetch converts HTML to markdown with its title, authorized as web_fetch with the URL", async () => {
  const { ctx } = setup();
  const call = fetchPage(ctx, "https://site.test/page");
  assert.deepEqual(call.authorization, {
    toolName: "web_fetch",
    args: { url: "https://site.test/page" },
    summary: "https://site.test/page",
  });
  const page = (await call.run()) as unknown as Record<string, string>;
  assert.equal(page.title, "A & B");
  assert.equal(page.status, 200);
  assert.match(page.contentType, /^text\/html/);
  assert.match(page.content, /# Hello/);
  assert.match(page.content, /World/);
});

void test("web.fetch parses JSON, and as: text keeps the source", async () => {
  const { ctx } = setup();
  const json = (await fetchPage(ctx, "https://site.test/data").run()) as {
    content: unknown;
  };
  assert.deepEqual(json.content, { a: [1, 2] });
  const asText = (await fetchPage(ctx, {
    url: "https://site.test/data",
    as: "text",
  }).run()) as { content: unknown };
  assert.equal(asText.content, '{"a":[1,2]}');
  await assert.rejects(
    fetchPage(ctx, { url: "https://site.test/page", as: "json" }).run(),
    /did not return valid JSON/,
  );
});

void test("web.fetch saves binary content as an artifact with exact bytes", async () => {
  const { ctx, record } = setup();
  assert.equal(
    await fetchPage(ctx, "https://site.test/img").run(),
    "artifact:web-1.png",
  );
  assert.deepEqual(record.artifacts.get("artifact:web-1.png")?.bytes, PNG);
  assert.equal(
    await fetchPage(ctx, {
      url: "https://site.test/page",
      as: "file",
      name: "p.html",
    }).run(),
    "artifact:p.html",
  );
  await assert.rejects(
    fetchPage(ctx, { url: "https://site.test/img", as: "text" }).run(),
    /use as: "file"/,
  );
});

void test("web.fetch maps HTTP failures to host codes", async () => {
  const { ctx } = setup();
  await assert.rejects(fetchPage(ctx, "https://site.test/missing").run(), {
    code: "NOT_FOUND",
  });
});

void test("web.search returns compact hits via Tavily with the account's injected credential", async () => {
  const { ctx, tavily } = setup();
  // A bound tool passes `max_results`; a script passes `limit`.
  for (const args of [
    { query: "nerve", limit: 2 },
    { query: "nerve", max_results: 2 },
  ]) {
    const input = webMethods.search.parse([args]);
    assert.deepEqual(webMethods.search.authorize?.(input), {
      targets: [],
      summary: "nerve",
    });
    assert.deepEqual(await webMethods.search.run(undefined, input, ctx), [
      {
        title: "T",
        url: "https://x.test",
        snippet: "some text",
        published: "2025-01-02",
      },
      { title: "U", url: "https://y.test", snippet: "more" },
    ]);
  }
  const [request] = tavily;
  assert.deepEqual(request.auth, { account: "searchAccount" });
  assert.deepEqual(request.body, {
    json: { query: "nerve", max_results: 2, include_answer: false },
  });
  assert.equal(request.headers?.authorization, undefined);
});

void test("web.search without a Tavily account is DENIED with the setting to change; web.fetch still works", async () => {
  const { ctx, tavily } = setup(false);
  const input = webMethods.search.parse(["q"]);
  await assert.rejects(
    Promise.resolve(webMethods.search.run(undefined, input, ctx)),
    {
      code: "DENIED",
      message: /no Tavily account/,
      fix: /Settings → Extensions → Web/,
    },
  );
  assert.equal(tavily.length, 0);
  await fetchPage(ctx, "https://site.test/data").run();
});

void test("web_search is a direct tool bound to web.search and shown as links", () => {
  const [tool] = webExtension.tools ?? [];
  assert.equal(tool.name, "web_search");
  assert.equal("method" in tool && tool.method, "web.search");
  assert.equal(tool.display, "links");
  assert.deepEqual(tool.requires, { account: "searchAccount" });
});
