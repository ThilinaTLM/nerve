import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWellFormedStorage } from "./storage-xml.js";
import {
  createHarness,
  type FetchLike,
  type Nested,
  nestedName,
} from "../test-support.js";

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

function setup(wrap?: (inner: FetchLike) => FetchLike, deny?: Error) {
  const events: string[] = [];
  const requests: Request[] = [];
  const inner: FetchLike = async (url, init) => {
    const method = init.method;
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
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
  const authorized: Nested[] = [];
  const context = createHarness({
    fetch: wrap ? wrap(inner) : inner,
    authorize: (request) => {
      events.push(`authorize ${nestedName(request)}`);
      authorized.push(request);
      if (deny) throw deny;
    },
  });
  return { events, requests, authorized, context };
}

void test("pages.create converts Markdown to storage after authorizing", async () => {
  const { events, requests, authorized, context } = setup();
  const result = await context.run(
    `console.log(JSON.stringify(await confluence.pages.create({ space: "DOC", title: "T", parent: "7", body: "# Hi\\n\\n- a" })));`,
  );
  assert.equal(events[0], "authorize confluence.pages.create");
  assert.deepEqual(authorized[0], {
    operation: "confluence.pages.create",
    targets: ["confluence:space/DOC"],
    risk: "external_write",
  });
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
  const result = await context.run(
    `console.log(JSON.stringify(await confluence.pages.update({ id: "100", body: storage.raw("<p>new</p>"), message: "m" })));`,
  );
  assert.equal(nestedName(authorized[0]), "confluence.pages.update");
  const put = requests.find((r) => r.method === "PUT")!;
  assert.deepEqual(put.body.version, { number: 4, message: "m" });
  assert.equal(put.body.title, "Old");
  assert.equal(put.body.parentId, "7");
  assert.equal(put.body.body.value, "<p>new</p>");
  assert.equal(JSON.parse((result.content ?? "").split("\n")[0]).version, 4);
});

void test("pages.update with a stale version throws CONFLICT naming the current one", async () => {
  const { requests, context } = setup();
  const result =
    await context.run(`try { await confluence.pages.update({ id: "100", version: 2, body: storage.raw("<p>new</p>") }); } catch (e) { console.log(e.code, e.message); }
        const ok = await confluence.pages.update({ id: "100", version: 3, body: storage.raw("<p>new</p>") }); console.log(ok.version);`);
  assert.match(
    result.content ?? "",
    /^CONFLICT page 100 is at v3, you read v2; re-read the page and reapply your change\n4/,
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 1);
});

void test("pages.get by title authorizes the space searched and misses are NOT_FOUND", async () => {
  const { authorized, context } = setup();
  const result = await context.run(
    `try { await confluence.pages.get({ space: "DOC", title: "Nope" }); } catch (e) { console.log(e.code); }`,
  );
  assert.deepEqual(authorized[0], {
    operation: "confluence.pages.get",
    targets: ["confluence:space/DOC"],
    risk: "network",
  });
  assert.match(result.content ?? "", /^NOT_FOUND/);
});

void test("pages.get returns Markdown by default", async () => {
  const { context } = setup();
  const result = await context.run(
    `const p = await confluence.pages.get("100"); console.log(JSON.stringify(p));`,
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
  const result = await context.run(`
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
      `);
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
  const { events, context } = setup(undefined, new Error("approval required"));
  const result = await context.run(
    `try { await confluence.labels.add({ id: "100", labels: ["x"] }); } catch (e) { console.log(e.message); }`,
  );
  assert.deepEqual(events, ["authorize confluence.labels.add"]);
  assert.match(result.content, /^approval required/);
  assert.deepEqual(
    context.hostCalls.map((call) => call.outcome),
    ["denied"],
  );
});

void test("labels.add authorizes the page once for all labels", async () => {
  const { authorized, context } = setup();
  await context.run(
    `await confluence.labels.add({ id: "100", labels: ["a", "b", "c"] });`,
  );
  assert.deepEqual(authorized, [
    {
      operation: "confluence.labels.add",
      targets: ["confluence:page/100"],
      risk: "external_write",
    },
  ]);
});

void test("a server error on child lookup fails the call instead of listing no children", async () => {
  const { events, context } = setup(
    (inner) => (url, init) =>
      url.pathname.endsWith("/direct-children")
        ? new Response("{}", { status: 503 })
        : inner(url, init),
  );
  const result = await context.run(
    `try { await confluence.pages.get({ id: "100", children: true }); } catch (e) { console.log("failed", e.code); }`,
  );
  assert.match(result.content ?? "", /failed SERVER_ERROR/);
  assert.equal(events.filter((e) => e.endsWith("/children")).length, 0);
});

void test("a redirect to another host is followed without the credential, and only to allowed hosts", async () => {
  const { context } = setup(
    () => async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      }),
  );
  const result = await context.run(
    `try { await confluence.pages.get({ id: "100" }); } catch (e) { console.log(e.code, e.message); }`,
  );
  assert.match(
    result.content,
    /^DENIED https:\/\/evil\.example is not allowed/,
  );
});

void test("a plain string that is storage XHTML is refused with the fix; body and bodyFile are exclusive", async () => {
  const { requests, context } = setup();
  const result =
    await context.run(`for (const o of [{ body: "<p>x</p>" }, { body: (await confluence.pages.get({ id: "100", body: "storage" })).body + "<p>y</p>" }]) {
          try { await confluence.pages.create({ space: "DOC", title: "T", ...o }); } catch (e) { console.log(e.message.slice(0, 40)); } }
        try { await confluence.pages.update({ id: "100", body: "a", bodyFile: "artifact:p.xhtml" }); } catch (e) { console.log(e.message); }`);
  assert.match(
    result.content ?? "",
    /^This string is storage XHTML but not tru\nThis string is storage XHTML but not tru\nPass body or bodyFile, not both\./,
  );
  assert.equal(requests.filter((r) => r.method === "POST").length, 0);
});

void test("page.body from pages.get round-trips as trusted storage in an array", async () => {
  const { requests, context } = setup();
  const result =
    await context.run(`const page = await confluence.pages.get({ id: "100", body: "storage" });
        await confluence.pages.update({ id: "100", version: page.version, body: [page.body, "## New", storage.status("Done")] });`);
  assert.match(result.content ?? "", /exit 0/);
  const put = requests.find((r) => r.method === "PUT")!;
  assert.match(
    put.body.body.value,
    /^<h1>Head<\/h1><p>Hello <strong>world<\/strong><\/p><h1>New<\/h1><p><ac:structured-macro ac:name="status"/,
  );
});

void test("pages.download saves the storage body; bodyFile writes it back", async () => {
  const { requests, context } = setup();
  const result =
    await context.run(`const d = await confluence.pages.download({ id: "100" });
        console.log(JSON.stringify(d));
        const text = await files.read(d.file);
        await files.write("page-100.xhtml", text.replace("Head", "Heading"));
        await confluence.pages.update({ id: "100", version: d.version, bodyFile: d.file });`);
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
  const { requests, context } = setup(
    (inner) => (url, init) =>
      init.method === "GET" && url.pathname.endsWith("/pages/100")
        ? Response.json({
            id: "100",
            title: "Old",
            version: { number: 3 },
            body: { storage: { value: RICH } },
          })
        : inner(url, init),
  );
  const result =
    await context.run(`try { await confluence.pages.update({ id: "100", body: storage.raw("<p>plain</p>") }); } catch (e) { console.log(e.code, e.message); }
        console.log((await confluence.pages.update({ id: "100", body: storage.raw("<p>plain</p>"), allowRemoving: true })).version);
        const more = [storage.raw(${JSON.stringify(RICH)}), storage.toc()];
        console.log((await confluence.pages.update({ id: "100", body: more })).version);`);
  assert.match(
    result.content ?? "",
    /^BAD_REQUEST update would remove 2 status, 1 info\. Build the body from the current one .* or pass allowRemoving: true\.\n4\n4/,
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 2);
});

void test("comments.add and attachment uploads are listed as created", async () => {
  const { context } = setup(
    (inner) => (url, init) =>
      url.pathname.endsWith("/child/attachment")
        ? Response.json({
            results: [
              {
                id: "att9",
                title: "a.txt",
                extensions: { mediaType: "text/plain", fileSize: 1 },
              },
            ],
          })
        : inner(url, init),
  );
  const result = await context.run(
    `await files.write("a.txt", "x");
        await confluence.comments.add({ id: "100", body: "hi" });
        await confluence.attachments.upload({ id: "100", file: "artifact:a.txt" });`,
  );
  assert.match(result.content ?? "", /confluence comment 55/);
  assert.match(result.content ?? "", /attachment att9 on page 100/);
});

void test("attachments.download round-trips binary bytes and lists choices on a miss", async () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 13, 10, 0xc3, 0x28,
  ]);
  const { authorized, context } = setup((inner) => (url, init) => {
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
    return inner(url, init);
  });
  const result = await context.run(
    `const a = await confluence.attachments.download({ id: "att1" });
        const b = await confluence.attachments.download({ page: "100", filename: "pic one.png" });
        console.log(a, b, (await files.read(a, { as: "bytes" })).join(","));
        try { await confluence.attachments.download({ page: "100", filename: "x.png" }); } catch (e) { console.log(e.code, e.message); }`,
  );
  assert.match(
    result.content ?? "",
    /^artifact:pic one-1\.png artifact:pic one-2\.png /,
  );
  assert.deepEqual(
    [...context.record.artifacts.get("artifact:pic one-1.png")!.bytes],
    [...png],
  );
  assert.match(
    result.content ?? "",
    /NOT_FOUND Page 100 has no attachment "x\.png"\. Attachments: pic one\.png/,
  );
  assert.equal(nestedName(authorized[0]), "confluence.attachments.download");
});

void test("request refuses atlas_doc_format writes, encodes query and saves binary responses", async () => {
  let blobUrl: URL | undefined;
  const { requests, context } = setup((inner) => (url, init) => {
    if (url.pathname === "/wiki/rest/api/blob") {
      blobUrl = url;
      return new Response(Uint8Array.from([1, 2, 3, 255]), {
        headers: { "content-type": "application/pdf" },
      });
    }
    return inner(url, init);
  });
  const result = await context.run(
    `try { await confluence.request("PUT", "/wiki/api/v2/pages/100", { body: { representation: "atlas_doc_format", value: "{}" } }); } catch (e) { console.log(e.code, e.message.slice(0, 33)); }
        console.log(await confluence.request("GET", "/wiki/rest/api/blob", undefined, { q: "a&b c", ids: ["1", "2"] }));
        console.log(await confluence.request("GET", "/wiki/api/v2/spaces"));`,
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
      ...context.record.artifacts.get("artifact:confluence-response-1.pdf")!
        .bytes,
    ],
    [1, 2, 3, 255],
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 0);
});
