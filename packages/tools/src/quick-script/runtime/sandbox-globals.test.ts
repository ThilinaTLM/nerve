import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createQuickScriptRegistry } from "../registry.js";
import { demoExtension } from "../extension-host/test-extension.js";
import { executeQuickScript } from "./quick-script.js";

const plain = createQuickScriptRegistry([]);

async function run(
  code: string,
  options: {
    signal?: AbortSignal;
    timeout?: number;
    registry?: typeof plain;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "quick-script-globals-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const result = await executeQuickScript(
    { code, ...(options.timeout ? { timeout: options.timeout } : {}) },
    {
      registry: options.registry ?? plain,
      cwd,
      conversationDir: join(root, "conversation"),
      signal: options.signal,
      authorizeNested: async () => undefined,
    },
  );
  return result;
}

void test("timers wait for their delay; clearTimeout and clearInterval stop callbacks", async () => {
  const { content } = await run(`
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log("waited", Date.now() - start >= 290);
    const cancelled = setTimeout(() => console.log("fired"), 30);
    clearTimeout(cancelled);
    let ticks = 0;
    const interval = setInterval(() => { ticks++; }, 40);
    await sleep(250);
    clearInterval(interval);
    const seen = ticks;
    await sleep(120);
    console.log("ticks", seen >= 3, ticks === seen);
  `);
  assert.equal(
    content?.split("\n").slice(0, 2).join("|"),
    "waited true|ticks true true",
  );
});

void test("a pending sleep ends with the script's cancellation or timeout", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const started = Date.now();
  const cancelled = await run(`await sleep(60000);`, {
    signal: controller.signal,
  });
  assert.equal((cancelled.details as { status?: string }).status, "cancelled");
  assert.ok(Date.now() - started < 5000);

  const timedOut = await run(`await sleep(60000);`, { timeout: 1 });
  assert.equal((timedOut.details as { status?: string }).status, "timed_out");
});

void test("URL, URLSearchParams and the UTF-8 codecs exist; Intl and crypto do not", async () => {
  const { content } = await run(`
    const url = new URL("../x?a=1&b=c d#h", "https://Example.com:443/p/q/r");
    url.searchParams.append("k", "v w");
    console.log(url.href, url.origin);
    console.log(new URLSearchParams({ a: "1", b: "é" }).toString());
    console.log(new TextDecoder().decode(new TextEncoder().encode("héllo ✓")));
    console.log(typeof Intl, typeof crypto);
  `);
  assert.deepEqual(content?.split("\n").slice(0, 4), [
    "https://example.com/p/x?a=1&b=c+d&k=v+w#h https://example.com",
    "a=1&b=%C3%A9",
    "héllo ✓",
    "undefined undefined",
  ]);
});

void test("a rejection the script catches is not printed as unhandled by the bundled Promise polyfill", async () => {
  const { content } = await run(`
    void PptxGenJS;
    const doc = new docx.Document({ sections: [{ children: [new docx.Paragraph("x")] }] });
    try { await docx.Packer.toBuffer(doc); } catch (e) { console.log("caught", e.message); }
  `);
  assert.match(content ?? "", /^caught /);
  assert.doesNotMatch(content ?? "", /Unhandled/);
});

void test("plain errors from extension helper code carry BAD_REQUEST; the script's own errors do not", async () => {
  const registry = createQuickScriptRegistry([
    {
      ...demoExtension,
      prelude: `globalThis.helper = { fail: () => { throw new Error("bad input"); }, later: async () => { throw new Error("late"); }, ok: () => 1 };`,
    },
  ]);
  const { content } = await run(
    `
    const codes = [];
    try { helper.fail(); } catch (e) { codes.push(e.code); }
    try { await helper.later(); } catch (e) { codes.push(e.code); }
    try { throw new Error("mine"); } catch (e) { codes.push(String(e.code)); }
    console.log(codes.join(","), helper.ok());
  `,
    { registry },
  );
  assert.equal(content?.split("\n")[0], "BAD_REQUEST,BAD_REQUEST,undefined 1");
});

void test("sdk.list and sdk.search return promises; a small doc topic stays whole after the discovery budget is spent", async () => {
  const { content } = await run(`
    console.log(sdk.list() instanceof Promise, sdk.search("fetch") instanceof Promise);
    for (let i = 0; i < 8; i++) await sdk.docs("libraries/documents");
    const small = await sdk.docs("image/chain");
    console.log(small.includes("discovery budget"), small.length);
  `);
  const lines = content?.split("\n") ?? [];
  assert.equal(lines[0], "true true");
  assert.match(lines[1], /^false \d+$/);
});

void test("timer waits do not count toward the host-call cap", async () => {
  const { content } = await run(`
    for (let i = 0; i < 250; i++) await sleep(1);
    console.log("done");
  `);
  assert.equal(content?.split("\n")[0], "done");
});

void test("setInterval periods are at least 10 ms", async () => {
  const { content } = await run(`
    const stamps = [];
    await new Promise((resolve) => {
      const id = setInterval(() => {
        stamps.push(Date.now());
        if (stamps.length === 6) { clearInterval(id); resolve(undefined); }
      }, 1);
    });
    console.log("span", stamps[5] - stamps[0] >= 45);
  `);
  assert.equal(content?.split("\n")[0], "span true");
});

void test("SDK calls still hit the host-call cap of 200", async () => {
  const { content } = await run(`
    let done = 0;
    try {
      for (let i = 0; i < 201; i++) { await sdk.search("x"); done++; }
    } catch (e) { console.log(done, String(e.message ?? e)); }
  `);
  assert.match(content ?? "", /^200 .*host call limit of 200 reached/);
});
