import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { quickScriptResultDetailsSchema } from "@nervekit/contracts/tools";
import { executeQuickScript } from "./quick-script.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Nested = {
  toolName: string;
  args: Record<string, unknown>;
  approvalRequired?: boolean;
};

function context(authorized: Nested[] = []) {
  return {
    cwd: process.cwd(),
    getApiKey: async () => "token",
    getProviderConfig: async (): Promise<Record<string, unknown>> => ({
      enabled: true,
      siteUrl: "https://example.atlassian.net",
      email: "dev@example.com",
    }),
    authorizeNested: async (request: Nested) => {
      authorized.push(request);
    },
  };
}

const run = (
  code: string,
  ctx: Parameters<typeof executeQuickScript>[1] = context(),
) => executeQuickScript({ code }, ctx);

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

void test("atlassian.defaults() returns configured products once per run", async () => {
  let requests = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requests += 1;
    const url = String(input);
    const body = url.includes("/myself")
      ? { accountId: "j1", displayName: "Ann", emailAddress: "a@x.com" }
      : { accountId: "c1", publicName: "Ann C" };
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
  const authorized: Nested[] = [];
  const result = await run(
    `const a = await atlassian.defaults(); await atlassian.defaults(); return a;`,
    {
      ...context(authorized),
      getProviderConfig: async (id?: string) => ({
        enabled: true,
        siteUrl: "https://example.atlassian.net",
        email: "dev@example.com",
        ...(id === "jira"
          ? { defaultProjectKey: "SCRUM" }
          : { defaultSpaceKey: "ENG" }),
      }),
    },
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.equal(requests, 2);
  assert.match(result.content ?? "", /"project":"SCRUM"/);
  assert.match(result.content ?? "", /"space":"ENG"/);
  assert.match(result.content ?? "", /"name":"Ann C"/);
});

void test("atlassian.defaults() omits an unconfigured product", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ accountId: "j1", displayName: "Ann" }), {
      headers: { "content-type": "application/json" },
    });
  const result = await run(`return await atlassian.defaults();`, {
    ...context(),
    getProviderConfig: async (id?: string) =>
      id === "jira"
        ? {
            enabled: true,
            siteUrl: "https://example.atlassian.net",
            email: "dev@example.com",
          }
        : { enabled: false },
  });
  assert.equal(result.exitCode, 0, result.content);
  assert.match(result.content ?? "", /jira/);
  assert.doesNotMatch(result.content ?? "", /confluence/);
});

void test("a script runs without integrations; an absent product names the setting to fix", async () => {
  const none = {
    ...context(),
    getApiKey: async (): Promise<string | undefined> => undefined,
    getProviderConfig: async (): Promise<Record<string, unknown> | undefined> =>
      undefined,
  };
  const ok = await run(`return 1 + 1;`, none);
  assert.equal(ok.exitCode, 0, ok.content);
  const missing = await run(
    `try { await confluence.pages.get("1"); } catch (e) { return e.message; }`,
    none,
  );
  assert.match(
    missing.content ?? "",
    /not available in quick_script.*Settings → Extensions → Atlassian/s,
  );
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
    /Jira rejected the API token for dev@example\.com; update it in Settings → Extensions → Atlassian\.\n.*failed · exit 1$/s,
  );
  const details = quickScriptResultDetailsSchema.parse(result.details);
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
  const details = quickScriptResultDetailsSchema.parse(result.details);
  assert.equal(details.hostCalls[0].error, "no access to project APP");
});

void test("denials carry the DENIED code", async () => {
  const ctx = {
    ...context(),
    authorizeNested: async () => {
      const { ToolExecutionError } = await import("@nervekit/tools/execution");
      throw new ToolExecutionError("NESTED_DENIED", "policy says no");
    },
  };
  const result = await run(
    `try { await jira.users.search("a"); } catch (e) { console.log(e.code, e.message); }`,
    ctx,
  );
  assert.match(result.content ?? "", /^DENIED policy says no/);
});

void test("prepare and validation failures carry the BAD_REQUEST code", async () => {
  const result = await run(
    `for (const attempt of [() => jira.issues.search({ jql: "project = A", fields: ["x"], bogus: 1 }), () => jira.issues.get()] ) {
       try { await attempt(); console.log("ok"); } catch (e) { console.log(e.code); }
     }`,
  );
  assert.match(result.content ?? "", /^BAD_REQUEST\nBAD_REQUEST\n/);
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
    `try { await confluence.pages.create({ space: "ENGINEERNG", title: "T", body: "x" }); } catch (e) { console.log(e.message); }`,
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
  // Non-GET raw requests are never allowed by another tool's rule alone.
  assert.deepEqual(
    authorized.slice(0, 4).map((r) => r.approvalRequired === true),
    [false, true, false, true],
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
  assert.match(big.content ?? "", /Response is larger than 5 MB/);
});

void test("cancelling aborts the in-flight host request and the run settles cancelled", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    setTimeout(() => controller.abort(), 20);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    });
  };
  const result = await executeQuickScript(
    { code: `await jira.issues.get("A-1");` },
    { ...context(), signal: controller.signal },
  );
  assert.equal(requestSignal?.aborted, true);
  assert.equal(result.exitCode, 130);
});

void test("a 401 aborts the other in-flight host requests", async () => {
  const signals: AbortSignal[] = [];
  globalThis.fetch = (_input, init) => {
    if (signals.push(init!.signal!) === 1) {
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(init!.signal!.reason),
        );
      });
    }
    return Promise.resolve(new Response("{}", { status: 401 }));
  };
  const result = await run(
    `await Promise.allSettled([jira.issues.get("A-1"), jira.issues.get("A-2")]);`,
  );
  assert.equal(signals[0]?.aborted, true);
  assert.equal(result.exitCode, 1);
});

void test("a misspelled SDK method lists the valid names with a BAD_REQUEST code", async () => {
  const result = await run(`
    try { await confluence.pages.list({}); } catch (e) { return [e.code, e.message]; }
  `);
  const [code, message] = JSON.parse(result.content!.split("\n")[0]) as [
    string,
    string,
  ];
  assert.equal(code, "BAD_REQUEST");
  assert.match(
    message,
    /^confluence\.pages\.list does not exist\. Available: .*search.*get.*/,
  );
  const ok = await run(
    `return [typeof jira.issues.get, JSON.stringify({ a: 1 }), String(files)];`,
  );
  assert.match(
    ok.content!,
    /^\["function","\{\\"a\\":1\}","\[object Object\]"\]/,
  );
});

void test("request() with an undefined body on GET sends no body", async () => {
  let init: RequestInit | undefined;
  globalThis.fetch = async (_input, requestInit) => {
    init = requestInit;
    return new Response("{}", {
      headers: { "content-type": "application/json" },
    });
  };
  const result = await run(
    `await jira.request("GET", "/rest/api/3/search/jql", undefined, { jql: "x" });
     await confluence.request("GET", "/wiki/api/v2/spaces", null, { limit: 1 });`,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.equal(init?.body, undefined);
  assert.equal(
    (init?.headers as Record<string, string>)["Content-Type"],
    undefined,
  );
});

void test("a host call still running when the script times out is aborted and does not touch the result", async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    });
  };
  const result = await executeQuickScript(
    { code: `await jira.issues.get("A-1");`, timeout: 1 },
    context(),
  );
  assert.equal(result.exitCode, 124);
  assert.equal(requestSignal?.aborted, true);
  const calls = (result.details as { hostCalls: unknown[] }).hostCalls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((result.details as { hostCalls: unknown[] }).hostCalls, calls);
  assert.ok(
    calls.every((call) => (call as { outcome: string }).outcome === "failed"),
  );
});

void test("Raw footer lines come only from request(), not from typed destructive methods", async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const result = await run(
    `await jira.issues.delete("A-1"); await jira.request("DELETE", "/rest/api/3/issue/A-2");`,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.match(result.content ?? "", /^Deleted: A-1$/m);
  assert.match(
    result.content ?? "",
    /^Raw: DELETE \/rest\/api\/3\/issue\/A-2$/m,
  );
  assert.doesNotMatch(result.content ?? "", /Raw: .*A-1/);
});
