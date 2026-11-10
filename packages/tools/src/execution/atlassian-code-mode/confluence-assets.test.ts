import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { image } from "@nervekit/native";
import { codeModeResultDetailsSchema } from "@nervekit/contracts/tools";
import { assertWellFormedStorage } from "../confluence/storage-xml.js";
import { executeAtlassianCodeMode } from "./atlassian-code-mode.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

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

async function setup(options: { deny?: string } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "code-mode-"));
  const events: string[] = [];
  const requests: Recorded[] = [];
  const authorized: Array<{ toolName: string; args: Record<string, unknown> }> =
    [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    events.push(`fetch ${method} ${url.host}${url.pathname}`);
    const form = init?.body instanceof FormData ? init.body : undefined;
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as PageBody)
        : undefined;
    requests.push({ method, path: url.pathname, body, form });
    if (url.host === "kroki.test") {
      return new Response(new Uint8Array(png(800, 400)), {
        headers: { "content-type": "image/png" },
      });
    }
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
  const context = {
    cwd,
    kroki: { url: "http://kroki.test/" },
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
      if (options.deny === request.toolName)
        throw new Error(`denied ${request.toolName}`);
    },
  };
  return { cwd, events, requests, authorized, context };
}

void test("attachments.upload authorizes manage_attachment and read before any I/O, then returns dimensions", async () => {
  const { cwd, events, requests, authorized, context } = await setup();
  await writeFile(join(cwd, "chart.png"), png(1200, 600));
  const result = await executeAtlassianCodeMode(
    {
      code: `console.log(JSON.stringify(await confluence.attachments.upload("100", { path: "chart.png", comment: "c" })));`,
    },
    context,
  );
  assert.deepEqual(events.slice(0, 2), [
    "authorize confluence_manage_attachment",
    "authorize read",
  ]);
  assert.equal(events[2]?.startsWith("fetch PUT"), true);
  assert.equal(authorized[1].args.path, join(cwd, "chart.png"));
  assert.deepEqual(JSON.parse(result.content!.split("\n")[0]), {
    id: "att1",
    filename: "chart.png",
    mediaType: "image/png",
    size: 64,
    width: 1200,
    height: 600,
  });
  assert.equal((requests[0].form!.get("file") as File).name, "chart.png");
});

void test("a denied read stops the upload before any HTTP", async () => {
  const { cwd, events, context } = await setup({ deny: "read" });
  await writeFile(join(cwd, "a.png"), png(10, 10));
  const result = await executeAtlassianCodeMode(
    {
      code: `try { await confluence.attachments.upload("100", { path: "a.png" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.ok(events.every((event) => event.startsWith("authorize")));
  assert.match(result.content ?? "", /denied read/);
  assert.equal(
    codeModeResultDetailsSchema.parse(result.details).hostCalls[0].outcome,
    "denied",
  );
});

void test("SVG attachments are rejected with guidance", async () => {
  const { cwd, context } = await setup();
  await writeFile(
    join(cwd, "d.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  );
  const result = await executeAtlassianCodeMode(
    {
      code: `try { await confluence.attachments.upload("100", { path: "d.svg" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /SVG attachments are not supported.*diagram\.render/,
  );
});

void test(
  "GIFs are converted to PNG on upload",
  { skip: !image.isAvailable() },
  async () => {
    const { cwd, requests, context } = await setup();
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    await writeFile(join(cwd, "anim.gif"), gif);
    const result = await executeAtlassianCodeMode(
      {
        code: `console.log(JSON.stringify(await confluence.attachments.upload("100", { path: "anim.gif" })));`,
      },
      context,
    );
    const uploaded = JSON.parse(result.content!.split("\n")[0]);
    assert.equal(uploaded.filename, "anim.png");
    assert.equal(uploaded.mediaType, "image/png");
    assert.equal(requests[0].form!.get("file") instanceof File, true);
  },
);

void test("pages.create with attachments: create, upload, then save again so images resolve", async () => {
  const { cwd, events, requests, context } = await setup();
  await writeFile(join(cwd, "shot.png"), png(1400, 700));
  const result = await executeAtlassianCodeMode(
    {
      code: `
        const page = await confluence.pages.create({
          space: "DOC", title: "T",
          body: storage.h1("Intro") + storage.image("shot.png", { alt: "Shot" }) + storage.image("missing.png"),
          attachments: [{ path: "shot.png" }],
        });
        console.log(JSON.stringify(page));
      `,
    },
    context,
  );
  assert.deepEqual(
    events
      .filter((e) => e.startsWith("fetch"))
      .map((e) => e.split(" ").slice(0, 2).join(" ")),
    ["fetch GET", "fetch POST", "fetch PUT", "fetch PUT"],
  );
  // Authorizations (create, per-attachment manage + read) all precede the first fetch.
  assert.deepEqual(events.slice(0, 3), [
    "authorize confluence_create_page",
    "authorize confluence_manage_attachment",
    "authorize read",
  ]);
  const post = requests.find((r) => r.method === "POST")!;
  const body = post.body!.body.value;
  assertWellFormedStorage(body);
  assert.match(body, /ac:width="760"/);
  const pageUpdate = requests.filter((r) => r.method === "PUT" && r.body)[0];
  assert.equal(pageUpdate.body!.version.number, 2);
  assert.equal(pageUpdate.body!.body.value, body);
  const page = JSON.parse(result.content!.split("\n")[0]);
  assert.equal(page.version, 2);
  assert.equal(page.attachments[0].width, 1400);
  assert.match(page.warnings.join("\n"), /"missing\.png" has no width/);
  assert.match(
    page.warnings.join("\n"),
    /references attachment "missing\.png" that was not attached/,
  );
});

void test("malformed bodies are rejected before any HTTP", async () => {
  const { events, context } = await setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `try { await confluence.pages.create({ space: "DOC", title: "T", body: "<p>unclosed" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /not well-formed storage XHTML: <p> opened at line 1 is never closed/,
  );
  assert.equal(events.filter((e) => e.startsWith("fetch")).length, 0);
});

void test("diagram.render keeps bytes host-side and the handle uploads as an attachment", async () => {
  const { events, requests, authorized, context } = await setup();
  const result = await executeAtlassianCodeMode(
    {
      code: `
        const d = await diagram.render({ type: "mermaid", source: "graph TD; A-->B" });
        console.log(JSON.stringify(d));
        const up = await confluence.attachments.upload("100", { file: d, filename: "flow.png" });
        console.log(JSON.stringify(up));
      `,
    },
    context,
  );
  assert.deepEqual(authorized[0], {
    toolName: "kroki_export",
    args: { diagram_type: "mermaid", source: "graph TD; A-->B" },
  });
  assert.equal(events[0], "authorize kroki_export");
  const [handleLine, uploadLine] = result.content!.split("\n");
  const handle = JSON.parse(handleLine);
  assert.deepEqual(Object.keys(handle).sort(), [
    "file",
    "filename",
    "height",
    "width",
  ]);
  assert.equal(handle.width, 800);
  assert.ok(handleLine.length < 200, "the handle must not carry bytes");
  assert.equal(JSON.parse(uploadLine).filename, "flow.png");
  assert.equal((requests.at(-1)!.form!.get("file") as File).size, 64);
});

void test("storage builders produce well-formed XHTML", async () => {
  const { requests, context } = await setup();
  await executeAtlassianCodeMode(
    {
      code: `
        const body = [
          storage.h1("Overview"), storage.p("Plain & simple"),
          storage.layout([storage.markdown("left **bold**"), storage.panel("tip", "right")], { type: "two_left_sidebar" }),
          storage.h1("Work"),
          storage.table([{ k: "APP-1", s: "Summary" }], { columns: [{ key: "k", title: "Key", width: 90 }, { key: "s", title: "Summary" }], layout: "wide" }),
          storage.tasks([{ text: "one", done: true }, "two"]),
          storage.p("See " + storage.link("https://x.test/?a=1&b=2", "docs") + " by " + storage.mention("abc") + " on " + storage.date("2026-01-02")),
          storage.image("a.png", { width: 300, caption: "Cap", alt: "A" }),
          storage.h1("Last"), storage.p("x"),
        ].join("");
        await confluence.pages.create({ space: "DOC", title: "T", body });
      `,
    },
    context,
  );
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
  assert.ok(
    value.startsWith('<ac:structured-macro ac:name="toc"'),
    "3 sections get a TOC",
  );
});
