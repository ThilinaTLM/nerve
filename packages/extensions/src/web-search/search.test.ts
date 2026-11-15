import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpRequest, HttpResponse } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { webSearchExtension } from "./manifest.js";
import { tavilyProvider } from "./providers/tavily.js";
import { searchMethods, webSearchTool } from "./search-methods.js";

const reply = (body: unknown, status = 200): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { "content-type": "application/json" },
  url: "https://api.tavily.com/x",
  body: typeof body === "string" ? body : JSON.stringify(body),
});

function setup(account = true, kind = "tavily") {
  const tavily: HttpRequest[] = [];
  const fake = createFakeContext({
    accounts: account
      ? { searchAccount: { id: "t1", name: "T", kind, fields: {} } }
      : {},
    http: (request) => {
      tavily.push(request);
      return reply({
        answer: "The answer.",
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
    },
  });
  return { ...fake, tavily };
}

void test("search.web returns compact hits via the Tavily provider with the account's injected credential", async () => {
  const { ctx, tavily } = setup();
  // A bound tool passes `max_results`; a script passes `limit`.
  for (const args of [
    { query: "nerve", limit: 2 },
    { query: "nerve", max_results: 2 },
  ]) {
    const input = searchMethods.web.parse([args]);
    assert.deepEqual(searchMethods.web.authorize?.(input), {
      targets: [],
      summary: "nerve",
    });
    assert.deepEqual(await searchMethods.web.run(undefined, input, ctx), [
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
  assert.equal(request.url, "https://api.tavily.com/search");
  assert.deepEqual(request.auth, { account: "searchAccount" });
  assert.deepEqual(request.body, {
    json: { query: "nerve", max_results: 2, include_answer: false },
  });
  assert.equal(request.headers?.authorization, undefined);
});

void test("search.web without an account, or of a kind no provider serves, is DENIED", async () => {
  const none = setup(false);
  const input = searchMethods.web.parse(["q"]);
  await assert.rejects(
    Promise.resolve(searchMethods.web.run(undefined, input, none.ctx)),
    {
      code: "DENIED",
      message: /no search account/,
      fix: /Settings → Extensions → Web Search/,
    },
  );
  const other = setup(true, "unknown");
  await assert.rejects(
    Promise.resolve(searchMethods.web.run(undefined, input, other.ctx)),
    { code: "DENIED", message: /no search provider.*'unknown'/ },
  );
  assert.equal(none.tavily.length + other.tavily.length, 0);
});

void test("a provider's HTTP failure keeps its host code", async () => {
  const { ctx } = createFakeContext({
    accounts: {
      searchAccount: { id: "t1", name: "T", kind: "tavily", fields: {} },
    },
    http: () => reply("slow down", 429),
  });
  await assert.rejects(
    Promise.resolve(
      searchMethods.web.run(undefined, searchMethods.web.parse(["q"]), ctx),
    ),
    { code: "RATE_LIMITED" },
  );
});

void test("the extension offers Tavily's account kind and only its origin to the network", () => {
  assert.equal(webSearchExtension.id, "web-search");
  assert.deepEqual(Object.keys(webSearchExtension.accounts ?? {}), ["tavily"]);
  assert.deepEqual(webSearchExtension.permissions?.network, [
    "https://api.tavily.com",
  ]);
  assert.deepEqual(
    webSearchExtension.namespaces.map((namespace) => namespace.id),
    ["search"],
  );
});

void test("web_search is a direct tool sharing search.web's authorization, shown as links", () => {
  const [tool] = webSearchExtension.tools ?? [];
  assert.equal(tool.name, "web_search");
  assert.ok("run" in tool && !("method" in tool));
  assert.deepEqual(tool.view, {
    header: { argument: "query" },
    meta: ["max_results"],
    sections: [{ id: "results", type: "links" }],
  });
  assert.deepEqual(tool.requires, { account: "searchAccount" });
  const input = webSearchTool.parse({ query: "nerve", max_results: 3 });
  assert.deepEqual(webSearchTool.authorize(input), {
    operation: "search.web",
    targets: [],
    summary: "nerve",
  });
});

void test("web_search gives the agent the answer and full result content, the transcript bounded links", async () => {
  const { ctx, tavily } = setup();
  const long = "word ".repeat(200);
  const output = await webSearchTool.run({ query: "nerve", limit: 2 }, ctx);
  assert.deepEqual(tavily[0].body, {
    json: { query: "nerve", max_results: 2, include_answer: true },
  });
  assert.equal(output.answer, "The answer.");
  const presented = webSearchTool.present({
    ...output,
    results: [{ ...output.results[0], content: long }, output.results[1]],
  });
  assert.equal(
    presented.text,
    [
      "**Answer:** The answer.",
      "",
      "### T",
      "https://x.test",
      "",
      long,
      "",
      "### U",
      "https://y.test",
      "",
      "more",
    ].join("\n"),
  );
  assert.deepEqual(presented.details, {
    query: "nerve",
    answer: "The answer.",
  });
  const links = presented.sections.results as { snippet?: string }[];
  assert.equal(links[0].snippet?.length, 300);
  assert.equal(links[1].snippet, "more");
});

const account = { id: "t1", name: "T", kind: "tavily", fields: {} };
const usage = (body: unknown, status = 200) => {
  const { ctx, record } = createFakeContext({
    http: () => reply(body, status),
  });
  return { ctx, record };
};
const testHook = tavilyProvider.account.test;

void test("the Tavily test hook reports the plan and credits: the key's limit when it has one, else the plan's", async () => {
  assert.ok(testHook);
  const { ctx, record } = usage({
    key: { usage: 150, limit: 1000 },
    account: { current_plan: "Bootstrap", plan_usage: 500, plan_limit: 15000 },
  });
  assert.deepEqual(await testHook(account, ctx), {
    ok: true,
    message: "Bootstrap plan · 150 / 1,000 credits",
  });
  assert.equal(record.requests[0].url, "https://api.tavily.com/usage");
  assert.deepEqual(record.requests[0].auth, { account: "searchAccount" });
  assert.deepEqual(
    await testHook(
      account,
      usage({
        key: { usage: 150, limit: null },
        account: {
          current_plan: "Bootstrap",
          plan_usage: 500,
          plan_limit: 15000,
        },
      }).ctx,
    ),
    { ok: true, message: "Bootstrap plan · 500 / 15,000 credits" },
  );
});

void test("the Tavily test hook maps exhausted credits and failures to a reason", async () => {
  assert.ok(testHook);
  const exhausted = await testHook(
    account,
    usage({ key: { usage: 1000, limit: 1000 }, account: {} }).ctx,
  );
  assert.equal(exhausted.ok, false);
  assert.equal(!exhausted.ok && exhausted.reason, "restricted");
  for (const [status, reason] of [
    [401, "rejected"],
    [403, "rejected"],
    [429, "unreachable"],
    [503, "unreachable"],
  ] as const) {
    const result = await testHook(account, usage("{}", status).ctx);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, reason, String(status));
  }
  const offline = createFakeContext({
    http: () => {
      throw new Error("ECONNREFUSED");
    },
  });
  const result = await testHook(account, offline.ctx);
  assert.equal(!result.ok && result.reason, "unreachable");
});
