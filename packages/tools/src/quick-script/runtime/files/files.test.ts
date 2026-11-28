import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { image } from "@nervekit/native";
import { executeQuickScript } from "../quick-script.js";
import { preludesFor } from "../sdk.js";
import type { QuickScriptNestedRequest } from "../../../execution/index.js";

import { createQuickScriptRegistry } from "../../registry.js";

const registry = createQuickScriptRegistry([]);

type Nested = { toolName: string; args: Record<string, unknown> };

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function png(width: number, height: number): Promise<Buffer> {
  return (
    await image.transformImage(PIXEL_PNG, {
      resize: { width, height, fit: "fill" },
    })
  ).data;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "quick-script-files-"));
  const cwd = join(root, "workspace");
  const conversationDir = join(root, "conversation");
  const artifactDir = join(conversationDir, "quick-script");
  await mkdir(cwd);
  const authorized: Nested[] = [];
  const context = {
    registry,
    cwd,
    conversationDir,
    authorizeNested: async (request: QuickScriptNestedRequest) => {
      authorized.push(request as Nested);
    },
  };
  const run = (code: string) => executeQuickScript({ code }, context);
  return { cwd, artifactDir, authorized, run };
}

void test("artifacts.write/read/list round-trip text and bytes without authorization", async () => {
  const { artifactDir, authorized, run } = await setup();
  const result = await run(`
    const bytes = new Uint8Array(300).map((_, i) => i % 256);
    const a = await artifacts.write({ name: "data.bin", data: bytes });
    const b = await artifacts.write({ name: "note.txt", data: "héllo" });
    const c = await artifacts.write({ name: "buf.bin", data: bytes.buffer });
    const back = await artifacts.read({ name: a, as: "bytes" });
    console.log(a, b, c, back.constructor.name, back.length, back.every((v, i) => v === i % 256));
    console.log(await artifacts.read("note.txt"));
    return await artifacts.list();
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(
    lines[0],
    "artifact:data.bin artifact:note.txt artifact:buf.bin Uint8Array 300 true",
  );
  assert.equal(lines[1], "héllo");
  assert.match(lines[2], /^handle \| name \| bytes \| mediaType \| modified$/);
  assert.match(
    lines[3],
    /^artifact:buf\.bin \| buf\.bin \| 300 \| application\/octet-stream \| /,
  );
  assert.deepEqual(authorized, []);
  // Windows has no POSIX permission bits.
  if (process.platform !== "win32")
    assert.equal((await stat(artifactDir)).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(artifactDir)).sort(), [
    "buf.bin",
    "data.bin",
    "note.txt",
  ]);
  assert.match(
    result.content ?? "",
    /Artifacts: artifact:data\.bin \(300 B\), artifact:note\.txt \(6 B\), artifact:buf\.bin \(300 B\)/,
  );
});

void test("artifact names are safe and sizes are capped", async () => {
  const { artifactDir, run } = await setup();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "big.bin"), Buffer.alloc(21 * 1024 * 1024));
  const result = await run(`
    for (const name of ["../escape.txt", "a/b.txt", ".hidden", "", " lead.txt", "x".repeat(200)]) {
      try { await artifacts.write({ name, data: "x" }); console.log("written", name); }
      catch (e) { console.log("rejected", JSON.stringify(name).slice(0, 20)); }
    }
    for (const attempt of [
      () => artifacts.read("artifact:../x"),
      () => artifacts.read({ name: "big.bin", as: "bytes" }),
      () => artifacts.write({ name: "huge.txt", data: "a".repeat(21 * 1024 * 1024) }),
    ]) {
      try { await attempt(); console.log("no error"); } catch (e) { console.log(e.message.slice(0, 70)); }
    }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.deepEqual(
    lines.slice(0, 6).map((l) => l.split(" ")[0]),
    Array(6).fill("rejected"),
  );
  assert.match(lines[6], /Invalid artifact name/);
  assert.match(lines[7], /artifact:big\.bin is 21.0 MB; the limit is 20.0 MB/);
  assert.match(lines[8], /data is 22020096 bytes; the limit is 20971520/);
  assert.deepEqual(await readdir(artifactDir), ["big.bin"]);
});

void test("workspace files are authorized as read/write and named relative to the cwd", async () => {
  const { cwd, authorized, run } = await setup();
  await writeFile(join(cwd, "in.txt"), "workspace text");
  const result = await run(`
    console.log(await files.read("in.txt"));
    console.log(await files.write({ path: "out/report.txt", data: "done" }));
    try { await files.read("artifact:x.txt"); } catch (e) { console.log(e.message); }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "workspace text");
  assert.equal(lines[1], "out/report.txt");
  assert.match(lines[2], /artifact:x\.txt is an artifact; use artifacts\.\*/);
  assert.match(result.content ?? "", /Created: file out\/report\.txt/);
  assert.equal(await readFile(join(cwd, "out/report.txt"), "utf8"), "done");
  assert.deepEqual(authorized, [
    { toolName: "read", args: { path: join(cwd, "in.txt") } },
    {
      toolName: "write",
      args: { path: join(cwd, "out/report.txt"), content: "" },
    },
  ]);
  assert.doesNotMatch(result.content ?? "", /Artifacts:/);
});

void test("artifacts.* needs an artifact folder", async () => {
  const result = await executeQuickScript(
    {
      code: `try { await artifacts.list(); } catch (e) { console.log(e.message); }`,
    },
    { cwd: process.cwd(), registry },
  );
  assert.match(result.content ?? "", /Artifacts are not available/);
});

void test("image(handle) resizes, crops and converts into new artifacts", async () => {
  const { cwd, artifactDir, authorized, run } = await setup();
  await writeFile(join(cwd, "wide.png"), await png(1200, 600));
  const result = await run(`
    console.log(JSON.stringify(await image("wide.png").info()));
    const small = await image("wide.png").resize({ width: 600 }).png().save("small.png");
    const crop = await image(small).crop({ left: 0, top: 0, width: 100, height: 50 }).jpeg({ quality: 70 }).save("crop");
    const noEnlarge = await image(small).resize({ width: 5000 }).info();
    console.log(small, crop, JSON.stringify(await image(crop).info()), noEnlarge.width);
    try { await image("artifact:missing.png").info(); } catch (e) { console.log("missing"); }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.deepEqual(JSON.parse(lines[0]), {
    format: "png",
    width: 1200,
    height: 600,
    bytes: (await png(1200, 600)).byteLength,
  });
  assert.match(
    lines[1],
    /^artifact:small\.png artifact:crop\.jpg \{"format":"jpeg","width":100,"height":50,"bytes":\d+\} 600$/,
  );
  assert.equal(lines[2], "missing");
  assert.deepEqual((await readdir(artifactDir)).sort(), [
    "crop.jpg",
    "small.png",
  ]);
  const small = await image.imageInfo(
    await readFile(join(artifactDir, "small.png")),
  );
  assert.deepEqual([small.width, small.height], [600, 300]);
  // Only the workspace source is checked (once per call that reads it).
  assert.deepEqual(
    [...new Set(authorized.map((r) => `${r.toolName} ${String(r.args.path)}`))],
    [`read ${join(cwd, "wide.png")}`],
  );
});

void test("XLSX and Papa work in the sandbox and load only for scripts that mention them", async () => {
  assert.equal(preludesFor(`console.log("no libraries")`, registry).length, 1);
  assert.equal(preludesFor(`const x = Papa.parse("a");`, registry).length, 2);
  assert.match(
    preludesFor(`XLSX.read`, registry)[1].source,
    /defineProperty\(globalThis, "XLSX"/,
  );

  const { run } = await setup();
  const result = await run(`
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ a: 1, b: "x" }, { a: 2, b: "y" }]), "Data");
    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const handle = await artifacts.write({ name: "table.xlsx", data: out });
    const bytes = await artifacts.read({ name: handle, as: "bytes" });
    const back = XLSX.read(bytes, { type: "array" });
    console.log(JSON.stringify(XLSX.utils.sheet_to_json(back.Sheets.Data)));
    const csv = Papa.unparse([{ a: 1, b: "x,y" }]);
    console.log(csv.replace("\\r\\n", "|"), JSON.stringify(Papa.parse("a,b\\n1,2", { header: true }).data));
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], '[{"a":1,"b":"x"},{"a":2,"b":"y"}]');
  assert.equal(lines[1], 'a,b|1,"x,y" [{"a":"1","b":"2"}]');
  const plain = await run(`return typeof XLSX;`);
  assert.equal(plain.content, "object");
});

void test("artifacts.write accepts a name or an artifact handle and keeps Unicode names", async () => {
  const { artifactDir, run } = await setup();
  const result = await run(`
    const a = await artifacts.write({ name: "artifact:a.txt", data: "one" });
    const b = await artifacts.write({ name: "résumé 日本.md", data: "two" });
    console.log(a, b, await artifacts.read(b));
    try { await artifacts.write({ name: "out/x.txt", data: "y" }); } catch (e) { console.log(e.message); }
    try { await artifacts.read("nope.txt"); } catch (e) { console.log(e.message); }
    try { await artifacts.read("nope.txt"); } catch (e) { console.log(e.code); }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "artifact:a.txt artifact:résumé 日本.md two");
  assert.match(lines[1], /For a workspace file use files\.\* instead/);
  assert.equal(
    lines[2],
    'artifact "nope.txt" not found; artifacts.list() shows: a.txt, résumé 日本.md',
  );
  assert.equal(lines[3], "NOT_FOUND");
  assert.deepEqual((await readdir(artifactDir)).sort(), [
    "a.txt",
    "résumé 日本.md",
  ]);
});

void test("artifacts.edit applies edits in order without authorization; a mismatch changes nothing", async () => {
  const { artifactDir, authorized, run } = await setup();
  const result = await run(`
    await artifacts.write({ name: "doc.md", data: "one two two two\\nthree" });
    const done = await artifacts.edit({ name: "doc.md", edits: [{ oldText: "one", newText: "1" }, { oldText: "1 two", newText: "x" }] });
    console.log(JSON.stringify(done.files));
    for (const edits of [[{ oldText: "two", newText: "2" }], [{ oldText: "three", newText: "3" }, { oldText: "zzz", newText: "2" }]]) {
      try { await artifacts.edit({ name: "doc.md", edits }); } catch (e) { console.log(e.message.split("\\n")[0]); }
    }
    try { await artifacts.edit({ name: "missing.md", edits: [{ oldText: "a", newText: "b" }] }); } catch (e) { console.log(e.message); }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.deepEqual(JSON.parse(lines[0]), [
    {
      path: "artifact:doc.md",
      changed: true,
      added: 1,
      removed: 1,
      edits: [
        { index: 0, matches: 1 },
        { index: 1, matches: 1 },
      ],
    },
  ]);
  assert.match(lines[1], /edits\[0\]\.oldText matched 2 times/);
  assert.match(lines[2], /edits\[1\]\.oldText was not found/);
  assert.match(lines[3], /^artifact "missing.md" not found/);
  assert.equal(
    await readFile(join(artifactDir, "doc.md"), "utf8"),
    "x two two\nthree",
  );
  assert.deepEqual(authorized, []);
});

void test("errors never show host paths", async () => {
  const { cwd, run } = await setup();
  const result = await run(`
    try { await files.read("missing/in.txt"); } catch (e) { console.log(e.code, e.message); }
  `);
  assert.equal(
    (result.content ?? "").split("\n")[0],
    "NOT_FOUND file not found: missing/in.txt",
  );
  assert.ok(!(result.content ?? "").includes(cwd));
});
