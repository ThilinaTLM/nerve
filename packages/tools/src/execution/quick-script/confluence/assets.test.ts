import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { image } from "@nervekit/native";
import { quickScriptResultDetailsSchema } from "@nervekit/contracts/tools";
import { assertWellFormedStorage } from "../../confluence/storage-xml.js";
import { executeQuickScript } from "../quick-script.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A real PNG of the given size (the native module stretches a 1x1 pixel). */
async function png(width: number, height: number): Promise<Buffer> {
  return (
    await image.transformImage(PIXEL_PNG, {
      resize: { width, height, fit: "fill" },
    })
  ).data;
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
  const root = await mkdtemp(join(tmpdir(), "quick-script-"));
  const cwd = join(root, "workspace");
  const conversationDir = join(root, "conversation");
  const artifactDir = join(conversationDir, "quick-script");
  await mkdir(cwd);
  const kroki = await png(800, 400);
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
      return new Response(new Uint8Array(kroki), {
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
    conversationDir,
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
  return { cwd, artifactDir, events, requests, authorized, context };
}

void test("attachments.upload authorizes manage_attachment and read before any I/O, then returns dimensions", async () => {
  const { cwd, events, requests, authorized, context } = await setup();
  await writeFile(join(cwd, "chart.png"), await png(1200, 600));
  const result = await executeQuickScript(
    {
      code: `console.log(JSON.stringify(await confluence.attachments.upload({ id: "100", file: "chart.png", comment: "c" })));`,
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
    size: (await png(1200, 600)).byteLength,
    width: 1200,
    height: 600,
  });
  assert.equal((requests[0].form!.get("file") as File).name, "chart.png");
});

void test("a denied read stops the upload before any HTTP", async () => {
  const { cwd, events, context } = await setup({ deny: "read" });
  await writeFile(join(cwd, "a.png"), await png(10, 10));
  const result = await executeQuickScript(
    {
      code: `try { await confluence.attachments.upload({ id: "100", file: "a.png" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.ok(events.every((event) => event.startsWith("authorize")));
  assert.match(result.content ?? "", /denied read/);
  assert.equal(
    quickScriptResultDetailsSchema.parse(result.details).hostCalls[0].outcome,
    "denied",
  );
});

void test("SVG attachments are rejected with guidance", async () => {
  const { cwd, context } = await setup();
  await writeFile(
    join(cwd, "d.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  );
  const result = await executeQuickScript(
    {
      code: `try { await confluence.attachments.upload({ id: "100", file: "d.svg" }); } catch (e) { console.log(e.message); }`,
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
    const result = await executeQuickScript(
      {
        code: `console.log(JSON.stringify(await confluence.attachments.upload({ id: "100", file: "anim.gif" })));`,
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
  await writeFile(join(cwd, "shot.png"), await png(1400, 700));
  const result = await executeQuickScript(
    {
      code: `
        const page = await confluence.pages.create({
          space: "DOC", title: "T",
          body: [storage.heading(1, "Intro"), storage.image("shot.png", { alt: "Shot" }), storage.image("missing.png")],
          attachments: ["shot.png"],
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
    /attachment "missing\.png" that is not on the page/,
  );
});

void test("malformed bodies are rejected before any HTTP", async () => {
  const { events, context } = await setup();
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.create({ space: "DOC", title: "T", body: storage.raw("<p>unclosed") }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /not well-formed storage XHTML: <p> opened at line 1 is never closed/,
  );
  assert.equal(events.filter((e) => e.startsWith("fetch")).length, 0);
});

void test("diagram.render saves an artifact and returns its handle; the handle uploads as an attachment", async () => {
  const { artifactDir, events, requests, authorized, context } = await setup();
  const result = await executeQuickScript(
    {
      code: `
        const d = await diagram.render({ type: "mermaid", source: "graph TD; A-->B" });
        console.log(d);
        const up = await confluence.attachments.upload({ id: "100", file: d, filename: "flow.png" });
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
  assert.equal(handleLine, "artifact:diagram-1.png");
  assert.deepEqual(await readdir(artifactDir), ["diagram-1.png"]);
  const uploaded = JSON.parse(uploadLine);
  assert.equal(uploaded.filename, "flow.png");
  assert.equal(uploaded.width, 800);
  assert.equal((requests.at(-1)!.form!.get("file") as File).name, "flow.png");
  // The artifact is listed after the script's output, and recorded in the details.
  assert.match(result.content ?? "", /Artifacts: artifact:diagram-1\.png \(\d/);
  const details = quickScriptResultDetailsSchema.parse(result.details);
  assert.equal(details.artifacts?.[0]?.handle, "artifact:diagram-1.png");
  assert.equal(details.artifacts?.[0]?.mediaType, "image/png");
});

void test("page attachments accept artifact handles and report the lint result automatically", async () => {
  const { context } = await setup();
  const result = await executeQuickScript(
    {
      code: `
        const d = await diagram.render({ type: "mermaid", source: "graph TD; A-->B", name: "flow.png" });
        await confluence.pages.create({
          space: "DOC", title: "Flow",
          body: [storage.heading(2, "Diagram"), storage.image("flow.png"), storage.image("other.png")],
          attachments: [d],
        });
      `,
    },
    context,
  );
  // Nothing was printed, yet the report names the page, fixes and warnings.
  const lines = (result.content ?? "").split("\n");
  assert.match(lines[0], /^Page 100 "Flow" created \(v2\) · fixes: /);
  assert.match(lines[0], /Promoted all headings/);
  assert.match(lines[0], /"other\.png" has no width/);
  assert.match(lines[1], /^Artifacts: artifact:flow\.png/);
  const details = quickScriptResultDetailsSchema.parse(result.details);
  assert.equal(details.pages?.[0]?.id, "100");
});

void test("storage builders produce well-formed XHTML", async () => {
  const { requests, context } = await setup();
  await executeQuickScript(
    {
      code: `
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
  assert.ok(!value.includes('ac:name="toc"'), "a short page gets no TOC");
});

void test("jiraIssues builds semicolon-separated columns and a layout; panels map Cloud names to storage macros", async () => {
  const { requests, context } = await setup();
  await executeQuickScript(
    {
      code: `
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
      `,
    },
    context,
  );
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
function failUploadsOf(filename: string) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const file = init?.body instanceof FormData ? init.body.get("file") : null;
    if (file instanceof File && file.name === filename)
      return new Response("{}", { status: 500 });
    return inner(input, init);
  };
}

void test("a failed upload after pages.create names the created page and the missing attachments", async () => {
  const { cwd, context } = await setup();
  await writeFile(join(cwd, "a.png"), await png(100, 50));
  await writeFile(join(cwd, "b.png"), await png(100, 50));
  failUploadsOf("b.png");
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.create({ space: "DOC", title: "T", body: storage.raw("<p>x</p>"), attachments: ["a.png", "b.png"] }); } catch (e) { console.log(e.code, e.message); }`,
    },
    context,
  );
  const text = result.content ?? "";
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
  const { cwd, requests, context } = await setup();
  await writeFile(join(cwd, "a.png"), await png(100, 50));
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    init?.method === "PUT" &&
    new URL(String(input)).pathname.endsWith("/pages/100")
      ? new Response("{}", { status: 500 })
      : inner(input, init);
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.update({ id: "100", body: storage.raw("<p>x</p>"), attachments: ["a.png"] }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /page 100 was not saved, but these attachments were already uploaded: a\.png/,
  );
  assert.ok(requests.some((r) => r.form));
});
