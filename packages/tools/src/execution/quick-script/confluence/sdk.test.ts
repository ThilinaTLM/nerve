import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { executeQuickScript } from "../quick-script.js";
import { assertWellFormedStorage } from "../../confluence/storage-xml.js";

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
  const result = await executeQuickScript(
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
    fixes: [],
    warnings: [],
  });
  assert.match(result.content ?? "", /confluence 1 call \(pages\.create 1\)/);
});

void test("pages.update fetches the current version and bumps it", async () => {
  const { requests, authorized, context } = setup();
  const result = await executeQuickScript(
    {
      code: `console.log(JSON.stringify(await confluence.pages.update({ id: "100", body: storage.raw("<p>new</p>"), message: "m" })));`,
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

void test("pages.update with a stale version throws CONFLICT naming the current one", async () => {
  const { requests, context } = setup();
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.update({ id: "100", version: 2, body: storage.raw("<p>new</p>") }); } catch (e) { console.log(e.code, e.message); }
        const ok = await confluence.pages.update({ id: "100", version: 3, body: storage.raw("<p>new</p>") }); console.log(ok.version);`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /^CONFLICT page 100 is at v3, you read v2; re-read the page and reapply your change\n4/,
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 1);
});

void test("pages.get by title authorizes as a page search and misses are NOT_FOUND", async () => {
  const { authorized, context } = setup();
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.get({ space: "DOC", title: "Nope" }); } catch (e) { console.log(e.code); }`,
    },
    context,
  );
  assert.deepEqual(authorized[0], {
    toolName: "confluence_search_pages",
    args: { space_key: "DOC", title: "Nope" },
  });
  assert.match(result.content ?? "", /^NOT_FOUND/);
});

void test("pages.get returns Markdown by default", async () => {
  const { context } = setup();
  const result = await executeQuickScript(
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
  const result = await executeQuickScript(
    {
      code: `
        const body = [
          storage.toc(),
          "# Intro\\n\\nSome *text* & more",
          storage.panel("info", "Heads **up**", { title: "Note" }),
          storage.panel("warning", storage.raw("<p>raw</p>")),
          storage.status("In progress", "blue"),
          storage.jiraIssue("SCRUM-1"),
          storage.jiraIssues("project = SCRUM", { columns: ["key", "summary"] }),
          storage.expand("More", "hidden"),
          storage.code("a ]]> b", { language: "ts" }),
          storage.table([{ Name: "A & B", Qty: 2 }, { Name: "C", Qty: 3 }]),
          storage.table([["h1", "h2"], ["x", "y"]]),
        ];
        await confluence.pages.create({ space: "DOC", title: "T", body });
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
  const result = await executeQuickScript(
    {
      code: `try { await confluence.labels.add({ id: "100", labels: ["x"] }); } catch (e) { console.log(e.message); }`,
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

void test("labels.add authorizes every label, not only the first", async () => {
  const { authorized, context } = setup();
  await executeQuickScript(
    {
      code: `await confluence.labels.add({ id: "100", labels: ["a", "b", "c"] });`,
    },
    context,
  );
  assert.deepEqual(
    authorized.map((request) => request.args.label),
    ["a", "b", "c"],
  );
});

void test("a server error on child lookup fails the call instead of listing no children", async () => {
  const { events, context } = setup();
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    new URL(String(input)).pathname.endsWith("/direct-children")
      ? new Response("{}", { status: 503 })
      : inner(input, init);
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.get({ id: "100", children: true }); } catch (e) { console.log("failed", e.code); }`,
    },
    context,
  );
  assert.match(result.content ?? "", /failed SERVER_ERROR/);
  assert.equal(events.filter((e) => e.endsWith("/children")).length, 0);
});

void test("a redirect on a credentialed Confluence request is an error", async () => {
  const { context } = setup();
  const seen: Array<RequestRedirect | undefined> = [];
  globalThis.fetch = async (_input, init) => {
    seen.push(init?.redirect);
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/steal" },
    });
  };
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.get({ id: "100" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.deepEqual(seen, ["manual"]);
  assert.match(result.content ?? "", /responded to .* with a redirect/);
});

void test("a plain string that is storage XHTML is refused with the fix; body and bodyFile are exclusive", async () => {
  const { requests, context } = setup();
  const result = await executeQuickScript(
    {
      code: `for (const o of [{ body: "<p>x</p>" }, { body: (await confluence.pages.get({ id: "100", body: "storage" })).body + "<p>y</p>" }]) {
          try { await confluence.pages.create({ space: "DOC", title: "T", ...o }); } catch (e) { console.log(e.message.slice(0, 40)); } }
        try { await confluence.pages.update({ id: "100", body: "a", bodyFile: "artifact:p.xhtml" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /^This string is storage XHTML but not tru\nThis string is storage XHTML but not tru\nPass body or bodyFile, not both\./,
  );
  assert.equal(requests.filter((r) => r.method === "POST").length, 0);
});

void test("page.body from pages.get round-trips as trusted storage in an array", async () => {
  const { requests, context } = setup();
  const result = await executeQuickScript(
    {
      code: `const page = await confluence.pages.get({ id: "100", body: "storage" });
        await confluence.pages.update({ id: "100", version: page.version, body: [page.body, "## New", storage.status("Done")] });`,
    },
    context,
  );
  assert.match(result.content ?? "", /exit 0/);
  const put = requests.find((r) => r.method === "PUT")!;
  assert.match(
    put.body.body.value,
    /^<h1>Head<\/h1><p>Hello <strong>world<\/strong><\/p><h1>New<\/h1><p><ac:structured-macro ac:name="status"/,
  );
});

void test("pages.download saves the storage body; bodyFile writes it back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qs-page-"));
  const { requests, context } = setup();
  const withDir = { ...context, conversationDir: dir };
  const result = await executeQuickScript(
    {
      code: `const d = await confluence.pages.download({ id: "100" });
        console.log(JSON.stringify(d));
        const text = await files.read(d.file);
        await files.write("page-100.xhtml", text.replace("Head", "Heading"));
        await confluence.pages.update({ id: "100", version: d.version, bodyFile: d.file });`,
    },
    withDir,
  );
  assert.match(
    result.content ?? "",
    /\{"file":"artifact:page-100\.xhtml","version":3,"title":"Old"\}/,
  );
  const put = requests.find((r) => r.method === "PUT")!;
  assert.equal(
    put.body.body.value,
    "<h1>Heading</h1><p>Hello <strong>world</strong></p>",
  );
});

const RICH =
  '<p>a</p><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">x</ac:parameter></ac:structured-macro><ac:structured-macro ac:name="status"></ac:structured-macro><ac:structured-macro ac:name="info"><ac:rich-text-body><p>n</p></ac:rich-text-body></ac:structured-macro>';

void test("pages.update refuses to drop structured elements unless allowRemoving", async () => {
  const { requests, context } = setup();
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (
      (init?.method ?? "GET") === "GET" &&
      url.pathname.endsWith("/pages/100")
    ) {
      return Response.json({
        id: "100",
        title: "Old",
        version: { number: 3 },
        body: { storage: { value: RICH } },
      });
    }
    return inner(input, init);
  };
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.update({ id: "100", body: storage.raw("<p>plain</p>") }); } catch (e) { console.log(e.code, e.message); }
        console.log((await confluence.pages.update({ id: "100", body: storage.raw("<p>plain</p>"), allowRemoving: true })).version);
        const more = [storage.raw(${JSON.stringify(RICH)}), storage.toc()];
        console.log((await confluence.pages.update({ id: "100", body: more })).version);`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /^BAD_REQUEST update would remove 2 status, 1 info\. Build the body from the current one .* or pass allowRemoving: true\.\n4\n4/,
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 2);
});

void test("comments.add and attachment uploads are listed as created", async () => {
  const { context } = setup();
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    new URL(String(input)).pathname.endsWith("/child/attachment")
      ? Response.json({
          results: [
            {
              id: "att9",
              title: "a.txt",
              extensions: { mediaType: "text/plain", fileSize: 1 },
            },
          ],
        })
      : inner(input, init);
  const result = await executeQuickScript(
    {
      code: `await files.write("a.txt", "x");
        await confluence.comments.add({ id: "100", body: "hi" });
        await confluence.attachments.upload({ id: "100", file: "artifact:a.txt" });`,
    },
    { ...context, conversationDir: await mkdtemp(join(tmpdir(), "cm-")) },
  );
  assert.match(result.content ?? "", /confluence comment 55/);
  assert.match(result.content ?? "", /attachment att9 on page 100/);
});

void test("attachments.download round-trips binary bytes and lists choices on a miss", async () => {
  const { authorized, context } = setup();
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 13, 10, 0xc3, 0x28,
  ]);
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/pages/100/attachments"))
      return Response.json({
        results: [
          {
            id: "att1",
            title: "pic one.png",
            downloadLink: "/download/attachments/100/pic.png",
          },
        ],
      });
    if (url.pathname.endsWith("/attachments/att1"))
      return Response.json({
        id: "att1",
        title: "pic one.png",
        downloadLink: "/download/attachments/100/pic.png",
      });
    if (url.pathname === "/wiki/download/attachments/100/pic.png")
      return new Response(png, { headers: { "content-type": "image/png" } });
    return inner(input, init);
  };
  const dir = await mkdtemp(join(tmpdir(), "cm-"));
  const result = await executeQuickScript(
    {
      code: `const a = await confluence.attachments.download({ id: "att1" });
        const b = await confluence.attachments.download({ page: "100", filename: "pic one.png" });
        console.log(a, b, (await files.read(a, { as: "bytes" })).join(","));
        try { await confluence.attachments.download({ page: "100", filename: "x.png" }); } catch (e) { console.log(e.code, e.message); }`,
    },
    { ...context, conversationDir: dir },
  );
  assert.match(
    result.content ?? "",
    /^artifact:pic one-1\.png artifact:pic one-2\.png /,
  );
  assert.deepEqual(
    [...(await readFile(join(dir, "quick-script", "pic one-1.png")))],
    [...png],
  );
  assert.match(
    result.content ?? "",
    /NOT_FOUND Page 100 has no attachment "x\.png"\. Attachments: pic one\.png/,
  );
  assert.equal(authorized[0].toolName, "confluence_get_page");
});

void test("request refuses atlas_doc_format writes, encodes query and saves binary responses", async () => {
  const { requests, context } = setup();
  const inner = globalThis.fetch;
  let blobUrl: URL | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/wiki/rest/api/blob")
      return (
        (blobUrl = url) &&
        new Response(Uint8Array.from([1, 2, 3, 255]), {
          headers: { "content-type": "application/pdf" },
        })
      );
    return inner(input, init);
  };
  const dir = await mkdtemp(join(tmpdir(), "cm-"));
  const result = await executeQuickScript(
    {
      code: `try { await confluence.request("PUT", "/wiki/api/v2/pages/100", { body: { representation: "atlas_doc_format", value: "{}" } }); } catch (e) { console.log(e.code, e.message.slice(0, 33)); }
        console.log(await confluence.request("GET", "/wiki/rest/api/blob", undefined, { q: "a&b c", ids: ["1", "2"] }));
        console.log(await confluence.request("GET", "/wiki/api/v2/spaces"));`,
    },
    { ...context, conversationDir: dir },
  );
  assert.match(
    result.content ?? "",
    /^BAD_REQUEST atlas_doc_format bodies are not/,
  );
  assert.match(result.content ?? "", /artifact:confluence-response-1\.pdf/);
  assert.equal(blobUrl?.searchParams.get("q"), "a&b c");
  assert.deepEqual(blobUrl?.searchParams.getAll("ids"), ["1", "2"]);
  assert.deepEqual(
    [
      ...(await readFile(
        join(dir, "quick-script", "confluence-response-1.pdf"),
      )),
    ],
    [1, 2, 3, 255],
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 0);
});
