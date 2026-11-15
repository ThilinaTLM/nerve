import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { executeQuickScript } from "../quick-script.js";
import { createQuickScriptRegistry } from "../../registry.js";
import type { QuickScriptNestedRequest } from "../../../execution/index.js";

const registry = createQuickScriptRegistry([]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 13, 10]);

let server: Server;
let base = "";
let root = "";

before(async () => {
  root = await mkdtemp(join(tmpdir(), "quick-script-web-"));
  server = createServer((request, response) => {
    const pages: Record<string, [string, string | Buffer]> = {
      "/page": [
        "text/html; charset=utf-8",
        "<html><head><title>A &amp; B</title></head><body><h1>Hello</h1></body></html>",
      ],
      "/data": ["application/json", '{"a":[1,2]}'],
      "/img": ["image/png", PNG],
    };
    const page = pages[request.url ?? ""];
    if (!page) {
      response.statusCode = request.url === "/busy" ? 429 : 404;
      return void response.end("nope");
    }
    response.setHeader("content-type", page[0]);
    response.end(page[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await rm(root, { recursive: true, force: true });
});

async function run(code: string, allowPrivateNetwork = true) {
  const cwd = join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  const conversationDir = join(root, "conversation");
  const authorized: QuickScriptNestedRequest[] = [];
  const result = await executeQuickScript(
    { code },
    {
      registry,
      cwd,
      conversationDir,
      webFetchPolicy: { allowPrivateNetwork },
      authorizeNested: async (request) => void authorized.push(request),
    },
  );
  return { result, authorized, conversationDir };
}

void test("web.fetch is built in, authorized as web_fetch, and converts HTML to markdown with its title", async () => {
  const { result, authorized } = await run(
    `console.log(JSON.stringify(await web.fetch("${base}/page")));`,
  );
  const page = JSON.parse((result.content ?? "").split("\n")[0]) as Record<
    string,
    unknown
  >;
  assert.equal(page.title, "A & B");
  assert.equal(page.status, 200);
  assert.match(String(page.content), /# Hello/);
  assert.deepEqual(authorized, [
    { toolName: "web_fetch", args: { url: `${base}/page` } },
  ]);
});

void test("web.fetch parses JSON, honours as: text, and saves binary content as an artifact with exact bytes", async () => {
  const { result, conversationDir } = await run(`
    console.log(JSON.stringify((await web.fetch("${base}/data")).content));
    console.log((await web.fetch({ url: "${base}/data", as: "text" })).content);
    try { await web.fetch({ url: "${base}/page", as: "json" }); } catch (e) { console.log(e.message.slice(0, 80)); }
    console.log(await web.fetch("${base}/img"));
    try { await web.fetch({ url: "${base}/img", as: "text" }); } catch (e) { console.log(e.message.includes('use as: "file"')); }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], '{"a":[1,2]}');
  assert.equal(lines[1], '{"a":[1,2]}');
  assert.match(lines[2], /did not return valid JSON/);
  assert.equal(lines[3], "artifact:web-1.png");
  assert.equal(lines[4], "true");
  assert.deepEqual(
    await readFile(join(conversationDir, "quick-script", "web-1.png")),
    PNG,
  );
});

void test("web.fetch maps HTTP statuses to host codes and applies the private-network policy", async () => {
  const { result } = await run(`
    for (const path of ["/missing", "/busy"]) {
      try { await web.fetch("${base}" + path); } catch (e) { console.log(e.code); }
    }
  `);
  assert.deepEqual((result.content ?? "").split("\n").slice(0, 2), [
    "NOT_FOUND",
    "RATE_LIMITED",
  ]);
  const blocked = await run(
    `try { await web.fetch("${base}/page"); } catch (e) { console.log(e.code); }`,
    false,
  );
  assert.equal(blocked.result.content?.split("\n")[0], "BAD_REQUEST");
});
