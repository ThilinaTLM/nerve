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
import type { QuickScriptNestedRequest } from "@nervekit/tools/execution";

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
    cwd,
    conversationDir,
    authorizeNested: async (request: QuickScriptNestedRequest) => {
      authorized.push(request as Nested);
    },
  };
  const run = (code: string) => executeQuickScript({ code }, context);
  return { cwd, artifactDir, authorized, run };
}

void test("files.write/read/list round-trip text and bytes through artifacts without authorization", async () => {
  const { artifactDir, authorized, run } = await setup();
  const result = await run(`
    const bytes = new Uint8Array(300).map((_, i) => i % 256);
    const a = await files.write("data.bin", bytes);
    const b = await files.write("note.txt", "héllo");
    const c = await files.write("buf.bin", bytes.buffer);
    const back = await files.read(a, { as: "bytes" });
    console.log(a, b, c, back.constructor.name, back.length, back.every((v, i) => v === i % 256));
    console.log(await files.read("artifact:note.txt"));
    return await files.list();
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
      try { await files.write(name, "x"); console.log("written", name); }
      catch (e) { console.log("rejected", JSON.stringify(name).slice(0, 20)); }
    }
    for (const attempt of [
      () => files.read("artifact:../x"),
      () => files.read("artifact:big.bin", { as: "bytes" }),
      () => files.write("huge.txt", "a".repeat(21 * 1024 * 1024)),
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
  assert.match(lines[7], /artifact:big\.bin is 21 MB; the limit is 20 MB/);
  assert.match(lines[8], /data is 22020096 bytes; the limit is 20971520/);
  assert.deepEqual(await readdir(artifactDir), ["big.bin"]);
});

void test("workspace files are authorized as read/write; escaping names cannot reach artifacts", async () => {
  const { cwd, authorized, run } = await setup();
  await writeFile(join(cwd, "in.txt"), "workspace text");
  const result = await run(`
    console.log(await files.read("in.txt"));
    console.log(await files.write("out/report.txt", "done", { workspace: true }));
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "workspace text");
  assert.equal(lines[1], join(cwd, "out/report.txt"));
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

void test("files.* needs an artifact folder", async () => {
  const result = await executeQuickScript(
    {
      code: `try { await files.list(); } catch (e) { console.log(e.message); }`,
    },
    { cwd: process.cwd() },
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
  assert.equal(preludesFor(`console.log("no libraries")`).length, 1);
  assert.equal(preludesFor(`const x = Papa.parse("a");`).length, 2);
  assert.match(
    preludesFor(`XLSX.read`)[1].source,
    /defineProperty\(globalThis, "XLSX"/,
  );

  const { run } = await setup();
  const result = await run(`
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ a: 1, b: "x" }, { a: 2, b: "y" }]), "Data");
    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const handle = await files.write("table.xlsx", out);
    const bytes = await files.read(handle, { as: "bytes" });
    const back = XLSX.read(bytes, { type: "array" });
    console.log(JSON.stringify(XLSX.utils.sheet_to_json(back.Sheets.Data)));
    const csv = Papa.unparse([{ a: 1, b: "x,y" }]);
    console.log(csv.replace("\\r\\n", "|"), JSON.stringify(Papa.parse("a,b\\n1,2", { header: true }).data));
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], '[{"a":1,"b":"x"},{"a":2,"b":"y"}]');
  assert.equal(lines[1], 'a,b|1,"x,y" [{"a":"1","b":"2"}]');
  const plain = await run(`return typeof XLSX;`);
  assert.equal(plain.content, "object\nexit 0");
});

void test("RichText Markdown in storage.* builders becomes storage markup", async () => {
  const { run } = await setup();
  const result = await run(`return storage.panel("info", "Some *emphasis*");`);
  assert.match(
    result.content ?? "",
    /<ac:rich-text-body><p>Some <em>emphasis<\/em><\/p><\/ac:rich-text-body>/,
  );
});

void test("files.write accepts a name or an artifact handle and keeps Unicode names", async () => {
  const { artifactDir, run } = await setup();
  const result = await run(`
    const a = await files.write("artifact:a.txt", "one");
    const b = await files.write("résumé 日本.md", "two");
    console.log(a, b, await files.read(b));
    try { await files.write("artifact:x.txt", "y", { workspace: true }); } catch (e) { console.log(e.message); }
    try { await files.read("artifact:nope.txt"); } catch (e) { console.log(e.message); }
    try { await files.read("artifact:nope.txt"); } catch (e) { console.log(e.code); }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "artifact:a.txt artifact:résumé 日本.md two");
  assert.match(lines[1], /is an artifact handle/);
  assert.equal(
    lines[2],
    'artifact "nope.txt" not found; files.list() shows: a.txt, résumé 日本.md',
  );
  assert.deepEqual((await readdir(artifactDir)).sort(), [
    "a.txt",
    "résumé 日本.md",
  ]);
});

void test("files.edit applies exact unique edits atomically to artifacts and authorizes workspace paths as edit", async () => {
  const { cwd, artifactDir, authorized, run } = await setup();
  await writeFile(join(cwd, "src.txt"), "alpha beta");
  const result = await run(`
    await files.write("doc.md", "one two two\\nthree");
    console.log(await files.edit("artifact:doc.md", [{ oldText: "one", newText: "1" }, { oldText: "three", newText: "3" }]));
    for (const edits of [[{ oldText: "two", newText: "2" }], [{ oldText: "zzz", newText: "2" }, { oldText: "1", newText: "x" }]]) {
      try { await files.edit("artifact:doc.md", edits); } catch (e) { console.log(e.message.split("\\n")[0]); }
    }
    try { await files.edit("artifact:missing.md", [{ oldText: "a", newText: "b" }]); } catch (e) { console.log(e.message); }
    console.log(await files.read("artifact:doc.md"));
    console.log(await files.edit("src.txt", [{ oldText: "beta", newText: "gamma" }]));
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "artifact:doc.md");
  assert.match(lines[1], /matched 2 times/);
  assert.match(lines[2], /edits\[0\]\.oldText was not found/);
  assert.match(lines[3], /^artifact "missing.md" not found/);
  assert.equal(lines[4], "1 two two");
  assert.equal(lines[5], "3");
  assert.equal(lines[6], join(cwd, "src.txt"));
  assert.equal(
    await readFile(join(artifactDir, "doc.md"), "utf8"),
    "1 two two\n3",
  );
  assert.equal(await readFile(join(cwd, "src.txt"), "utf8"), "alpha gamma");
  assert.deepEqual(
    authorized.map((r) => r.toolName),
    ["edit"],
  );
  assert.match(
    result.content ?? "",
    /Artifacts: artifact:doc\.md \(\d+ B\) in /,
  );
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
