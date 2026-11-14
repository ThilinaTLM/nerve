import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWellFormedStorage } from "./storage-xml.js";
import {
  createHarness,
  fakePng,
  type FetchLike,
  type Nested,
  nestedName,
} from "../test-support.js";

type PageBody = {
  title?: string;
  version: { number: number };
  body: { value: string };
};
type Recorded = {
  method: string;
  path: string;
  body?: PageBody;
  form?: FormData;
};

function setup(
  options: {
    deny?: string;
    files?: Record<string, Uint8Array | string>;
    wrap?: (inner: FetchLike) => FetchLike;
  } = {},
) {
  const events: string[] = [];
  const requests: Recorded[] = [];
  const authorized: Nested[] = [];
  const inner: FetchLike = async (url, init) => {
    const method = init.method;
    events.push(`fetch ${method} ${url.host}${url.pathname}`);
    const form = init.body instanceof FormData ? init.body : undefined;
    const body =
      typeof init.body === "string"
        ? (JSON.parse(init.body) as PageBody)
        : undefined;
    requests.push({ method, path: url.pathname, body, form });
    const path = url.pathname.replace("/wiki/api/v2", "");
    if (url.pathname.endsWith("/child/attachment")) {
      const file = form!.get("file") as File;
      return Response.json({
        results: [
          {
            id: "att1",
            title: file.name,
            extensions: { mediaType: file.type, fileSize: file.size },
          },
        ],
      });
    }
    if (path === "/spaces")
      return Response.json({ results: [{ id: "10", key: "DOC" }] });
    if (method === "POST" && path === "/pages") {
      return Response.json({
        id: "100",
        title: body!.title,
        version: { number: 1 },
        _links: { webui: "/spaces/DOC/pages/100/T" },
      });
    }
    if (method === "PUT" && path === "/pages/100") {
      return Response.json({
        id: "100",
        title: body!.title,
        version: body!.version,
      });
    }
    if (method === "GET" && path === "/pages/100") {
      return Response.json({
        id: "100",
        title: "Old",
        version: { number: 3 },
        body: { storage: { value: "<p>old</p>" } },
      });
    }
    return new Response("{}", { status: 404 });
  };
  const context = createHarness({
    files: options.files,
    fetch: options.wrap ? options.wrap(inner) : inner,
    authorize: (request) => {
      const name = nestedName(request);
      events.push(`authorize ${name}`);
      authorized.push(request);
      if (options.deny === name) throw new Error(`denied ${name}`);
    },
  });
  return { events, requests, authorized, context };
}

void test("attachments.upload authorizes the operation and read before any I/O, then returns dimensions", async () => {
  const chart = fakePng(1200, 600);
  const { events, requests, authorized, context } = setup({
    files: { "chart.png": chart },
  });
  const result = await context.run(
    `console.log(JSON.stringify(await confluence.attachments.upload({ id: "100", file: "chart.png", comment: "c" })));`,
  );
  assert.deepEqual(events.slice(0, 2), [
    "authorize confluence.attachments.upload",
    "authorize read",
  ]);
  assert.equal(events[2]?.startsWith("fetch PUT"), true);
  assert.deepEqual(authorized[1], {
    toolName: "read",
    args: { path: "chart.png" },
  });
  assert.deepEqual(JSON.parse(result.content.split("\n")[0]), {
    id: "att1",
    filename: "chart.png",
    mediaType: "image/png",
    size: chart.byteLength,
    width: 1200,
    height: 600,
  });
  assert.equal((requests[0].form!.get("file") as File).name, "chart.png");
});

void test("a denied read stops the upload before any HTTP", async () => {
  const { events, context } = setup({
    deny: "read",
    files: { "a.png": fakePng(10, 10) },
  });
  const result = await context.run(
    `try { await confluence.attachments.upload({ id: "100", file: "a.png" }); } catch (e) { console.log(e.message); }`,
  );
  assert.ok(events.every((event) => event.startsWith("authorize")));
  assert.match(result.content, /denied read/);
  assert.equal(result.hostCalls[0].outcome, "denied");
});

void test("SVG attachments are rejected with guidance", async () => {
  const { context } = setup({
    files: {
      "d.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    },
  });
  const result = await context.run(
    `try { await confluence.attachments.upload({ id: "100", file: "d.svg" }); } catch (e) { console.log(e.message); }`,
  );
  assert.match(
    result.content,
    /SVG attachments are not supported.*diagram\.render/,
  );
});

void test("GIFs upload unchanged, with the size read from their header", async () => {
  const gif = Uint8Array.from(
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
  const { requests, context } = setup({ files: { "anim.gif": gif } });
  const result = await context.run(
    `console.log(JSON.stringify(await confluence.attachments.upload({ id: "100", file: "anim.gif" })));`,
  );
  const uploaded = JSON.parse(result.content.split("\n")[0]);
  assert.equal(uploaded.filename, "anim.gif");
  assert.equal(uploaded.mediaType, "image/gif");
  assert.equal(uploaded.width, 1);
  assert.equal((requests[0].form!.get("file") as File).type, "image/gif");
});

void test("pages.create with attachments: create, upload, then save again so images resolve", async () => {
  const { events, requests, context } = setup({
    files: { "shot.png": fakePng(1400, 700) },
  });
  const result = await context.run(`
        const page = await confluence.pages.create({
          space: "DOC", title: "T",
          body: [storage.heading(1, "Intro"), storage.image("shot.png", { alt: "Shot" }), storage.image("missing.png")],
          attachments: ["shot.png"],
        });
        console.log(JSON.stringify(page));
      `);
  assert.deepEqual(
    events
      .filter((e) => e.startsWith("fetch"))
      .map((e) => e.split(" ").slice(0, 2).join(" ")),
    ["fetch GET", "fetch POST", "fetch PUT", "fetch PUT"],
  );
  // Authorizations (create, per-attachment read) all precede the first fetch.
  assert.deepEqual(events.slice(0, 2), [
    "authorize confluence.pages.create",
    "authorize read",
  ]);
  const post = requests.find((r) => r.method === "POST")!;
  const body = post.body!.body.value;
  assertWellFormedStorage(body);
  assert.match(body, /ac:width="760"/);
  const pageUpdate = requests.filter((r) => r.method === "PUT" && r.body)[0];
  assert.equal(pageUpdate.body!.version.number, 2);
  assert.equal(pageUpdate.body!.body.value, body);
  const page = JSON.parse(result.content.split("\n")[0]);
  assert.equal(page.version, 2);
  assert.equal(page.attachments[0].width, 1400);
  assert.match(
    page.warnings.join("\n"),
    /"missing\.png" that is not on the page/,
  );
  assert.doesNotMatch(page.warnings.join("\n"), /"missing\.png" has no width/);
  assert.match(
    page.warnings.join("\n"),
    /attachment "missing\.png" that is not on the page/,
  );
});

void test("malformed bodies are rejected before any HTTP", async () => {
  const { events, context } = setup();
  const result = await context.run(
    `try { await confluence.pages.create({ space: "DOC", title: "T", body: storage.raw("<p>unclosed") }); } catch (e) { console.log(e.message); }`,
  );
  assert.match(
    result.content,
    /not well-formed storage XHTML: <p> opened at line 1 is never closed/,
  );
  assert.equal(events.filter((e) => e.startsWith("fetch")).length, 0);
});

void test("an artifact handle uploads as an attachment under the name given", async () => {
  const { requests, context } = setup({
    files: { "artifact:diagram-1.png": fakePng(800, 400) },
  });
  const result = await context.run(`
        const up = await confluence.attachments.upload({ id: "100", file: "artifact:diagram-1.png", filename: "flow.png" });
        console.log(JSON.stringify(up));
      `);
  const uploaded = JSON.parse(result.content.split("\n")[0]);
  assert.equal(uploaded.filename, "flow.png");
  assert.equal(uploaded.width, 800);
  assert.equal((requests.at(-1)!.form!.get("file") as File).name, "flow.png");
  // An artifact is the run's own file: no read authorization.
  assert.deepEqual(context.authorized.map(nestedName), [
    "confluence.attachments.upload",
  ]);
});

void test("page attachments accept artifact handles and the footer reports the page and its lint result", async () => {
  const { context } = setup({
    files: { "artifact:flow.png": fakePng(800, 400) },
  });
  const result = await context.run(`
        await confluence.pages.create({
          space: "DOC", title: "Flow",
          body: [storage.heading(2, "Diagram"), storage.image("flow.png"), storage.image("other.png")],
          attachments: ["artifact:flow.png"],
        });
      `);
  // Nothing was printed, yet the footer names the page, fixes and warnings.
  const lines = result.content.split("\n");
  assert.equal(
    lines[0],
    'Created: attachment att1 on page 100, page 100 "Flow"',
  );
  assert.match(lines[1], /^Page 100 "Flow" created \(v2\) · fixes: /);
  assert.match(lines[1], /Promoted all headings/);
  assert.match(lines[1], /"other\.png" that is not on the page/);
});

void test("storage builders produce well-formed XHTML", async () => {
  const { requests, context } = setup();
  await context.run(`
        const body = [
          storage.heading(1, "Overview"), storage.p("Plain & simple"),
          storage.layout(["left **bold**", storage.panel("tip", "right")], { type: "two_left_sidebar" }),
          storage.heading(1, "Work"),
          storage.table([{ k: "APP-1", s: "Summary" }], { columns: [{ key: "k", title: "Key", width: 90 }, { key: "s", title: "Summary" }], layout: "wide" }),
          storage.tasks([{ text: "one", done: true }, "two"]),
          storage.p(["See ", storage.link("https://x.test/?a=1&b=2", "docs"), " by ", storage.mention("abc"), " on ", storage.date("2026-01-02")]),
          storage.image("a.png", { width: 300, caption: "Cap", alt: "A" }),
          storage.heading(1, "Last"), storage.p("x"),
        ];
        await confluence.pages.create({ space: "DOC", title: "T", body });
      `);
  const value = requests.find((r) => r.method === "POST")!.body!.body.value;
  assertWellFormedStorage(value);
  assert.ok(value.includes('<ac:layout-section ac:type="two_left_sidebar">'));
  assert.ok(
    value.includes('<col style="width: 90px;"/><col style="width: 870px;"/>'),
  );
  assert.ok(value.includes('data-layout="wide"'));
  assert.ok(value.includes("<ac:task-status>complete</ac:task-status>"));
  assert.ok(value.includes('<time datetime="2026-01-02"/>'));
  assert.ok(value.includes('ac:width="300"'));
  assert.ok(value.includes("<ac:caption><p>Cap</p></ac:caption>"));
  assert.ok(!value.includes('ac:name="toc"'), "a short page gets no TOC");
});

void test("jiraIssues builds semicolon-separated columns and a layout; panels map Cloud names to storage macros", async () => {
  const { requests, context } = setup();
  await context.run(`
        const body = [
          storage.heading(1, "A"),
          storage.jiraIssues("project = A", { columns: ["key", "summary", "type", "assignee"], limit: 20 }),
          storage.jiraIssues("project = B", { columns: "key, status", layout: "wide" }),
          storage.panel("info", ["Plain text", storage.date("2026-01-02")]),
          storage.panel("warning", "yellow"), storage.panel("error", "red", { title: "Blocked" }),
          storage.panel("success", "green"), storage.panel("note", "purple"),
          storage.expand("More", [storage.p("a"), storage.p("b")]),
        ];
        try { storage.panel("tip2", "x"); } catch (e) { console.log(e.message); }
        await confluence.pages.create({ space: "DOC", title: "T", body });
      `);
  const value = requests.find((r) => r.method === "POST")!.body!.body.value;
  assertWellFormedStorage(value);
  assert.ok(
    value.includes(
      '<ac:parameter ac:name="columns">key;summary;type;assignee</ac:parameter>',
    ),
  );
  assert.ok(
    value.includes('<ac:parameter ac:name="maximumIssues">20</ac:parameter>'),
  );
  assert.ok(
    value.includes('<ac:parameter ac:name="columns">key;status</ac:parameter>'),
  );
  assert.ok(
    value.includes('ac:schema-version="1" data-layout="default"'),
    "linter adds default layout",
  );
  assert.ok(
    value.includes('ac:schema-version="1" data-layout="wide"'),
    "explicit layout kept",
  );
  // warning (yellow) -> note, error (red) -> warning, success -> tip, info -> info, note (purple) -> panel
  assert.match(value, /ac:name="note"[^>]*><ac:rich-text-body><p>yellow<\/p>/);
  assert.match(
    value,
    /ac:name="warning"[^>]*><ac:parameter ac:name="title">Blocked<\/ac:parameter><ac:rich-text-body><p>red<\/p>/,
  );
  assert.match(value, /ac:name="tip"[^>]*><ac:rich-text-body><p>green<\/p>/);
  assert.match(
    value,
    /ac:name="panel"[^>]*><ac:parameter ac:name="borderStyle">solid.*#EAE6FF.*<p>purple<\/p>/,
  );
  // array bodies join their parts; the loose date is wrapped by the linter
  assert.match(
    value,
    /<p>Plain text<\/p><p><time datetime="2026-01-02"\/><\/p>/,
  );
  assert.ok(value.includes("<p>a</p><p>b</p></ac:rich-text-body>"));
});

/** Makes uploads of `filename` fail with a server error. */
const failUploadsOf =
  (filename: string) =>
  (inner: FetchLike): FetchLike =>
  (url, init) => {
    const file = init.body instanceof FormData ? init.body.get("file") : null;
    if (file instanceof File && file.name === filename)
      return new Response("{}", { status: 500 });
    return inner(url, init);
  };

void test("a failed upload after pages.create names the created page and the missing attachments", async () => {
  const { context } = setup({
    files: { "a.png": fakePng(100, 50), "b.png": fakePng(100, 50) },
    wrap: failUploadsOf("b.png"),
  });
  const result = await context.run(
    `try { await confluence.pages.create({ space: "DOC", title: "T", body: storage.raw("<p>x</p>"), attachments: ["a.png", "b.png"] }); } catch (e) { console.log(e.code, e.message); }`,
  );
  const text = result.content;
  assert.match(text, /^SERVER_ERROR /);
  assert.match(
    text,
    /page 100 \(https:\/\/example\.atlassian\.net\/wiki\/spaces\/DOC\/pages\/100\/T\) was already created/,
  );
  assert.match(
    text,
    /uploaded: a\.png; the remaining attachments .* are missing/,
  );
});

void test("a failed pages.update save names the attachments already uploaded", async () => {
  const { requests, context } = setup({
    files: { "a.png": fakePng(100, 50) },
    wrap: (inner) => (url, init) =>
      init.method === "PUT" && url.pathname.endsWith("/pages/100")
        ? new Response("{}", { status: 500 })
        : inner(url, init),
  });
  const result = await context.run(
    `try { await confluence.pages.update({ id: "100", body: storage.raw("<p>x</p>"), attachments: ["a.png"] }); } catch (e) { console.log(e.message); }`,
  );
  assert.match(
    result.content,
    /page 100 was not saved, but these attachments were already uploaded: a\.png/,
  );
  assert.ok(requests.some((r) => r.form));
});
