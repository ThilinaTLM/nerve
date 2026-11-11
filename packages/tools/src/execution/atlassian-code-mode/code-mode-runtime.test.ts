import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { codeModeResultDetailsSchema } from "@nervekit/contracts/tools";
import { executeAtlassianCodeMode } from "./atlassian-code-mode.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Nested = { toolName: string; args: Record<string, unknown> };

function context(authorized: Nested[] = []) {
  return {
    cwd: process.cwd(),
    getApiKey: async () => "token",
    getProviderConfig: async () => ({
      enabled: true,
      siteUrl: "https://example.atlassian.net",
      email: "dev@example.com",
    }),
    authorizeNested: async (request: Nested) => {
      authorized.push(request);
    },
  };
}

const run = (code: string, ctx = context()) =>
  executeAtlassianCodeMode({ code }, ctx);

void test("a top-level return prints flat objects as a table and everything else as JSON", async () => {
  const table = await run(
    `const rows = [{ key: "A-1", n: 1, note: "x\\ny" }, { key: "A-2", n: null, extra: true }];
     console.log("before");
     return rows;`,
  );
  assert.equal(
    table.content,
    "before\nkey | n | note | extra\nA-1 | 1 | x y | \nA-2 |  |  | true\nexit 0",
  );
  assert.equal(
    (await run(`return { a: [1, { b: 2 }] };`)).content,
    '{"a":[1,{"b":2}]}\nexit 0',
  );
  assert.equal((await run(`return "plain";`)).content, "plain\nexit 0");
  assert.equal((await run(`return;`)).content, "exit 0");
  // Mixed arrays are not tables; top-level await still works next to return.
  assert.equal(
    (
      await run(
        `const n: number = await Promise.resolve(2); return [n, { a: 1 }];`,
      )
    ).content,
    '[2,{"a":1}]\nexit 0',
  );
});

void test("error line numbers match the script and only script frames are shown", async () => {
  const result = await run(`\n\nconst a = 1;\nthrow new Error("boom");`);
  assert.equal(result.exitCode, 1);
  assert.match(
    result.content ?? "",
    /boom\n\s+at <anonymous> \(script\.ts:4:\d+\)\nfailed · exit 1$/,
  );
  assert.equal((result.content ?? "").match(/script\.ts/g)?.length, 1);
});

void test("a 401 stops the whole script with one message and no further requests", async () => {
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return new Response("{}", { status: 401 });
  };
  const result = await run(
    `try { await jira.issues.get("A-1"); } catch (e) { console.log("caught", e.message); }
     await jira.issues.get("A-2");
     console.log("never printed");`,
  );
  assert.equal(fetches, 1);
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.content ?? "", /never printed/);
  assert.match(
    result.content ?? "",
    /Jira rejected the API token for dev@example\.com; update it in Settings → Integrations\.\n.*failed · exit 1$/s,
  );
  const details = codeModeResultDetailsSchema.parse(result.details);
  assert.equal(details.status, "failed");
  assert.equal(details.error?.startsWith("Jira rejected"), true);
  assert.equal(details.hostCalls[0].outcome, "failed");
});

void test("a 403 is a catchable HostError with code FORBIDDEN naming the resource", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 403 });
  const result = await run(
    `try { await jira.projects.get({ key: "APP" }); } catch (e) { console.log(e.name, e.code, e.message); }
     console.log("continued");`,
  );
  assert.equal(
    result.content,
    "HostError FORBIDDEN no access to project APP\ncontinued\njira 1 call (projects.get 1) · exit 0",
  );
  const details = codeModeResultDetailsSchema.parse(result.details);
  assert.equal(details.hostCalls[0].error, "no access to project APP");
});

void test("denials carry the DENIED code", async () => {
  const ctx = {
    ...context(),
    authorizeNested: async () => {
      const { ToolExecutionError } = await import("../errors/tool-error.js");
      throw new ToolExecutionError("NESTED_DENIED", "policy says no");
    },
  };
  const result = await run(
    `try { await jira.users.search("a"); } catch (e) { console.log(e.code, e.message); }`,
    ctx,
  );
  assert.match(result.content ?? "", /^DENIED policy says no/);
});

void test("an unknown Jira field lists close matches", async () => {
  globalThis.fetch = async () =>
    Response.json([
      { id: "customfield_10016", name: "Story Points", custom: true },
      { id: "customfield_10020", name: "Sprint", custom: true },
    ]);
  const result = await run(
    `try { await jira.issues.search({ jql: "project = A", fields: ["Story Point"] }); } catch (e) { console.log(e.message); }`,
  );
  assert.match(
    result.content ?? "",
    /Unknown Jira field "Story Point"\. Did you mean: "Story Points"\?/,
  );
});

void test("an unknown space key lists close matches", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    // The key lookup (keys=...) finds nothing; the listing has close keys.
    return Response.json({
      results: url.searchParams.has("keys")
        ? []
        : [
            { id: "1", key: "ENGINEERING", name: "Engineering" },
            { id: "2", key: "HR", name: "People" },
          ],
    });
  };
  const result = await run(
    `try { await confluence.pages.create({ space: "ENGINEERNG", title: "T", body: "<p>x</p>" }); } catch (e) { console.log(e.message); }`,
  );
  assert.match(
    result.content ?? "",
    /No Confluence space with key "ENGINEERNG"\. Did you mean: ENGINEERING\?/,
  );
});

void test("request() is authorized by method and rejects URLs outside the product's REST bases", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return Response.json({ ok: true });
  };
  const authorized: Nested[] = [];
  const result = await run(
    `const attempts = [
       () => jira.request("GET", "/rest/api/3/myself"),
       () => jira.request("POST", "/rest/agile/1.0/sprint", { name: "S" }),
       () => confluence.request("GET", "/wiki/api/v2/spaces?limit=1"),
       () => confluence.request("DELETE", "/wiki/rest/api/content/1/label?name=x"),
       () => jira.request("GET", "https://evil.test/rest/api/3/myself"),
       () => jira.request("GET", "//evil.test/rest/api/3/myself"),
       () => jira.request("GET", "/rest/api/2/myself"),
       () => jira.request("GET", "/rest/api/3/../../x"),
       () => confluence.request("GET", "/rest/api/3/myself"),
       () => jira.request("TRACE", "/rest/api/3/myself"),
     ];
     for (const attempt of attempts) {
       try { const r = await attempt(); console.log("ok", JSON.stringify(r)); }
       catch (e) { console.log("error", e.message.slice(0, 60)); }
     }`,
    context(authorized),
  );
  const lines = (result.content ?? "").split("\n");
  assert.deepEqual(lines.slice(0, 4), [
    'ok {"ok":true}',
    'ok {"ok":true}',
    'ok {"ok":true}',
    'ok {"ok":true}',
  ]);
  assert.ok(
    lines.slice(4, 9).every((line) => line.startsWith("error path must")),
    lines.slice(4, 9).join("\n"),
  );
  assert.match(lines[9], /^error method must be one of/);
  assert.deepEqual(
    calls.map(
      (c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`,
    ),
    [
      "GET /rest/api/3/myself",
      "POST /rest/agile/1.0/sprint",
      "GET /wiki/api/v2/spaces?limit=1",
      "DELETE /wiki/rest/api/content/1/label?name=x",
    ],
  );
  // GET is a read; any other method is checked as a destructive manage tool.
  assert.deepEqual(
    authorized.slice(0, 4).map((r) => r.toolName),
    [
      "jira_get_project",
      "jira_manage_comment",
      "confluence_get_page",
      "confluence_manage_page",
    ],
  );
});

void test("request() returns text for non-JSON and refuses oversized responses", async () => {
  let mode: "text" | "big" = "text";
  globalThis.fetch = async () =>
    mode === "text"
      ? new Response("plain body", {
          headers: { "content-type": "text/plain" },
        })
      : new Response(new Uint8Array(6 * 1024 * 1024));
  const text = await run(
    `return await jira.request("GET", "/rest/api/3/serverInfo");`,
  );
  assert.match(text.content ?? "", /^plain body/);
  mode = "big";
  const big = await run(
    `try { await jira.request("GET", "/rest/api/3/x"); } catch (e) { console.log(e.message); }`,
  );
  assert.match(big.content ?? "", /Response is larger than 5242880 bytes/);
});
