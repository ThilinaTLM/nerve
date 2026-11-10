import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { executeAtlassianCodeMode } from "./atlassian-code-mode.js";
import { assertWellFormedStorage } from "./storage-xml.test-helper.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type PageBody = {
  title?: string;
  version?: unknown;
  parentId?: string;
  body: { value: string };
};
type Request = {
  method: string;
  path: string;
  search: URLSearchParams;
  body: PageBody;
};

function setup() {
  const events: string[] = [];
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    events.push(`fetch ${method} ${url.pathname}`);
    requests.push({
      method,
      path: url.pathname,
      search: url.searchParams,
      body,
    });
    const path = url.pathname.replace("/wiki/api/v2", "");
    if (path === "/spaces")
      return Response.json({
        results: [{ id: "10", key: "DOC", name: "Docs" }],
      });
    if (method === "POST" && path === "/pages") {
      return Response.json({
        id: "100",
        title: body.title,
        version: { number: 1 },
        _links: { webui: "/spaces/DOC/pages/100/T" },
      });
    }
    if (method === "PUT" && path === "/pages/100") {
      return Response.json({
        id: "100",
        title: body.title,
        version: body.version,
        _links: { webui: "/spaces/DOC/pages/100/T" },
      });
    }
    if (method === "GET" && path === "/pages/100") {
      return Response.json({
        id: "100",
        title: "Old",
        spaceId: "10",
        parentId: "7",
        version: { number: 3 },
        labels: { results: [{ name: "a" }] },
        body: {
          storage: {
            value: "<h2>Head</h2><p>Hello <strong>world</strong></p>",
          },
        },
        _links: { webui: "/spaces/DOC/pages/100/Old" },
      });
    }
    if (method === "POST" && path === "/footer-comments")
      return Response.json({ id: "55" });
    return new Response("{}", { status: 404 });
  };
  const authorized: Array<{ toolName: string; args: Record<string, unknown> }> =
    [];
  const context = {
    cwd: process.cwd(),
    getApiKey: async () => "token",
    getProviderConfig: async () => ({
      enabled: true,
      siteUrl: "https://example.atlassian.net",
      email: "dev@example.com",
    }),
    authorizeNested: async (request: {
      toolName: string;
      args: Record<string, unknown>;
    }) => {
      events.push(`authorize ${request.toolName}`);
      authorized.push(request);
    },
  };
  return { events, requests, authorized, context };
}

void test("pages.create converts Markdown to storage after authorizing", async () => {
  const { events, requests, authorized, context } = setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `console.log(JSON.stringify(await confluence.pages.create({ space: "DOC", title: "T", parent: "7", body: "# Hi\\n\\n- a" })));`,
    },
    context,
  );
  assert.equal(events[0], "authorize confluence_create_page");
  assert.equal(authorized[0].args.space_key, "DOC");
  const post = requests.find((r) => r.method === "POST")!;
  assert.deepEqual(post.body, {
    spaceId: "10",
    title: "T",
    parentId: "7",
    status: "current",
    body: {
      representation: "storage",
      value: "<h1>Hi</h1><ul><li><p>a</p></li></ul>",
    },
  });
  assert.deepEqual(JSON.parse((result.content ?? "").split("\n")[0]), {
    id: "100",
    title: "T",
    url: "https://example.atlassian.net/wiki/spaces/DOC/pages/100/T",
    version: 1,
  });
  assert.match(result.content ?? "", /confluence 1 call \(pages\.create 1\)/);
});

void test("pages.update fetches the current version and bumps it", async () => {
  const { requests, authorized, context } = setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `console.log(JSON.stringify(await confluence.pages.update("100", { body: "new", message: "m" })));`,
    },
    context,
  );
  assert.equal(authorized[0].toolName, "confluence_update_page");
  const put = requests.find((r) => r.method === "PUT")!;
  assert.deepEqual(put.body.version, { number: 4, message: "m" });
  assert.equal(put.body.title, "Old");
  assert.equal(put.body.parentId, "7");
  assert.equal(put.body.body.value, "<p>new</p>");
  assert.equal(JSON.parse((result.content ?? "").split("\n")[0]).version, 4);
});

void test("pages.get returns Markdown by default", async () => {
  const { context } = setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `const p = await confluence.pages.get("100"); console.log(JSON.stringify(p));`,
    },
    context,
  );
  const page = JSON.parse((result.content ?? "").split("\n")[0]);
  assert.equal(page.space, "DOC");
  assert.equal(page.version, 3);
  assert.equal(page.parentId, "7");
  assert.deepEqual(page.labels, ["a"]);
  assert.match(page.body, /## Head/);
  assert.match(page.body, /Hello \*\*world\*\*/);
});

void test("mixed storage helpers and Markdown produce a well-formed storage body", async () => {
  const { requests, context } = setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `
        const body = [
          storage.toc(),
          storage.markdown("# Intro\\n\\nSome *text* & more"),
          storage.panel("info", "Heads **up**", { title: "Note" }),
          storage.panel("warning", "<p>raw</p>"),
          storage.status("In progress", "blue"),
          storage.jiraIssue("SCRUM-1"),
          storage.jiraIssues("project = SCRUM", { columns: ["key", "summary"] }),
          storage.expand("More", "hidden"),
          storage.code("a ]]> b", { language: "ts" }),
          storage.table([{ Name: "A & B", Qty: 2 }, { Name: "C", Qty: 3 }]),
          storage.table([["h1", "h2"], ["x", "y"]]),
        ].join("");
        await confluence.pages.create({ space: "DOC", title: "T", body, format: "storage" });
      `,
    },
    context,
  );
  assert.match(result.content ?? "", /exit 0/);
  const value = requests.find((r) => r.method === "POST")!.body.body.value;
  assert.ok(!value.includes("\u0001") && !value.includes("\u0002"));
  assertWellFormedStorage(value);
  assert.ok(value.includes("<h1>Intro</h1>"));
  assert.ok(value.includes("Some <em>text</em> &amp; more"));
  assert.ok(value.includes('ac:name="info"'));
  assert.ok(value.includes("<strong>up</strong>"));
  assert.ok(
    value.includes('<ac:parameter ac:name="colour">Blue</ac:parameter>'),
  );
  assert.ok(
    value.includes(
      '<ac:parameter ac:name="jqlQuery">project = SCRUM</ac:parameter>',
    ),
  );
  assert.ok(value.includes("<![CDATA[a ]]]]><![CDATA[> b]]>"));
  assert.ok(value.includes("<th><p>Name</p></th>"));
  assert.ok(value.includes("<td><p>A &amp; B</p></td>"));
});

void test("write methods are denied before any HTTP", async () => {
  const { events, context } = setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `try { await confluence.labels.add("100", ["x"]); } catch (e) { console.log(e.message); }`,
    },
    {
      ...context,
      authorizeNested: async (request) => {
        events.push(`authorize ${request.toolName}`);
        throw new Error("approval required");
      },
    },
  );
  assert.deepEqual(events, ["authorize confluence_manage_label"]);
  assert.match(result.content ?? "", /^approval required/);
  assert.match(result.content ?? "", /1 denied/);
});
