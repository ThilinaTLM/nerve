import "./install.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { executeQuickScript } from "@nervekit/tools/quick-script/runtime/quick-script";
import type { QuickScriptNestedRequest } from "@nervekit/tools/execution";
import type { ExtensionHostPorts } from "@nervekit/tools/quick-script";

/*
 * The Diagrams and Web extensions through the real host (`ctx.http` with the
 * `{settings.server}` template, the `*` origin, injected bearer credential,
 * artifacts and HTML conversion), against a local server.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
let server: Server;
let base = "";
let root = "";
const seen: { url: string; authorization?: string; body: string }[] = [];

before(async () => {
  root = await mkdtemp(join(tmpdir(), "builtin-extensions-"));
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (request.url === "/kroki/") {
        response.setHeader("content-type", "image/png");
        return void response.end(PNG);
      }
      if (request.url === "/page") {
        response.setHeader("content-type", "text/html");
        return void response.end(
          "<html><head><title>Hi</title></head><body><h1>Hello</h1></body></html>",
        );
      }
      response.statusCode = 404;
      response.end("nope");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await rm(root, { recursive: true, force: true });
});

async function run(
  code: string,
  settings: Record<string, Record<string, unknown>>,
  generateImage?: ExtensionHostPorts["generateImage"],
) {
  const cwd = join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  const conversationDir = join(root, "conversation");
  const authorized: QuickScriptNestedRequest[] = [];
  const result = await executeQuickScript(
    { code },
    {
      cwd,
      conversationDir,
      webFetchPolicy: { allowPrivateNetwork: true },
      authorizeNested: async (request) => void authorized.push(request),
      extensionPorts: {
        generateImage,
        settings: (id) => settings[id] ?? {},
        accounts: {
          get: async (kind, id) =>
            kind === "tavily" && id === "t1"
              ? { id, name: "Tavily", kind, fields: {} }
              : undefined,
          secret: async () => "tvly-secret",
        },
      },
    },
  );
  return { result, authorized, conversationDir };
}

void test("diagram.render posts to the configured server and saves a PNG artifact", async () => {
  const { result, authorized, conversationDir } = await run(
    `console.log(await diagram.render({ type: "mermaid", source: "graph TD; A-->B" }));`,
    { diagram: { server: `${base}/kroki/` } },
  );
  assert.equal(result.content?.split("\n")[0], "artifact:diagram-1.png");
  assert.deepEqual(await readdir(join(conversationDir, "quick-script")), [
    "diagram-1.png",
  ]);
  assert.deepEqual(authorized[0], {
    operation: "diagram.render",
    targets: [],
    risk: "network",
  });
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), {
    diagram_source: "graph TD; A-->B",
    diagram_type: "mermaid",
    output_format: "png",
  });
});

void test("web.fetch reaches any public origin through ctx.http and converts HTML with the host", async () => {
  const { result, authorized } = await run(
    `const page = await web.fetch("${base}/page"); console.log(JSON.stringify(page));`,
    { web: { enabled: true } },
  );
  const page = JSON.parse(result.content!.split("\n")[0]) as Record<
    string,
    string
  >;
  assert.equal(page.title, "Hi");
  assert.match(page.content, /# Hello/);
  assert.deepEqual(authorized[0], {
    toolName: "web_fetch",
    args: { url: `${base}/page` },
  });
});

void test("web.search sends the selected account's key as a bearer credential the script never sees", async (t) => {
  const real = globalThis.fetch;
  let headers: Headers | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: unknown, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.tavily.com/"))
        return await real(input as string, init);
      headers = new Headers(init?.headers);
      return Response.json({
        results: [{ title: "T", url: "https://x.test", content: "text" }],
      });
    },
  );
  const { result } = await run(
    `const hits = await web.search("nerve"); console.log(JSON.stringify(hits));`,
    { web: { enabled: true, searchAccount: "t1" } },
  );
  assert.equal(headers?.get("authorization"), "Bearer tvly-secret");
  assert.deepEqual(JSON.parse(result.content!.split("\n")[0]), [
    { title: "T", url: "https://x.test", snippet: "text" },
  ]);
  assert.ok(!result.content?.includes("tvly-secret"));
});

void test("web.search without a selected account is DENIED before any request", async () => {
  const before = seen.length;
  const { result } = await run(
    `try { await web.search("x"); } catch (e) { console.log(e.code); }`,
    { web: { enabled: true } },
  );
  assert.equal(result.content?.split("\n")[0], "DENIED");
  assert.equal(seen.length, before);
});

void test("imagegen.generate calls the host's image capability with the call's options over the settings", async () => {
  const requests: Parameters<
    NonNullable<ExtensionHostPorts["generateImage"]>
  >[0][] = [];
  const { result, conversationDir } = await run(
    `console.log(await imagegen.generate({ prompt: "A cell", size: "1536x1024", name: "hero" }));`,
    {
      imagegen: {
        backend: "openai-codex",
        model: "gpt-image-2.5-flare",
        quality: "high",
        size: "auto",
        background: "auto",
      },
    },
    async (request) => {
      requests.push(request);
      return {
        provider: "openai-codex",
        model: request.options.model,
        images: [{ data: PNG }],
      };
    },
  );
  assert.equal(result.content?.split("\n")[0], "artifact:hero.png");
  assert.deepEqual(await readdir(join(conversationDir, "quick-script")), [
    "diagram-1.png",
    "hero.png",
  ]);
  assert.deepEqual(requests[0]?.options, {
    backend: "openai-codex",
    model: "gpt-image-2.5-flare",
    quality: "high",
    size: "1536x1024",
    background: "auto",
  });
});
