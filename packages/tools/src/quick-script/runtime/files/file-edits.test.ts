import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { QuickScriptNestedRequest } from "../../../execution/index.js";
import { createQuickScriptRegistry } from "../../registry.js";
import { executeQuickScript } from "../quick-script.js";
import { applyEdit, parseEdit } from "./text-edits.js";

const registry = createQuickScriptRegistry([]);

async function workspace(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "quick-script-edit-"));
  const cwd = join(root, "workspace");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(cwd, path, ".."), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
  const authorized: { toolName: string; args: Record<string, unknown> }[] = [];
  const run = async (code: string) => {
    const result = await executeQuickScript(
      { code },
      {
        registry,
        cwd,
        conversationDir: join(root, "conversation"),
        authorizeNested: async (request: QuickScriptNestedRequest) => {
          authorized.push(request as (typeof authorized)[number]);
        },
      },
    );
    return (result.content ?? "").split("\n");
  };
  const read = (path: string) => readFile(join(cwd, path), "utf8");
  return { cwd, root, authorized, run, read };
}

const apply = (content: string, raw: object, optional = false) =>
  applyEdit(content, parseEdit(raw, 0, []), "a.ts", optional);

void test("edit shapes: exact, replace all, regex, anchor ranges and inserts", () => {
  const text = "a();\nb();\nb();\nc();\n";
  assert.equal(
    apply(text, { oldText: "a()", newText: "x()" }).text,
    "x();\nb();\nb();\nc();\n",
  );
  assert.deepEqual(apply(text, { oldText: "b()", newText: "y()", all: true }), {
    text: "a();\ny();\ny();\nc();\n",
    matches: 2,
  });
  assert.equal(
    apply(text, {
      pattern: "([bc])\\(\\)",
      replacement: "$1(1)",
      all: true,
      count: 3,
    }).text,
    "a();\nb(1);\nb(1);\nc(1);\n",
  );
  assert.equal(
    apply(text, { from: "a();", through: "b();\n", newText: "" }).text,
    "b();\nc();\n",
  );
  assert.equal(
    apply(text, { from: "a();", upTo: "c();", newText: "" }).text,
    "c();\n",
  );
  assert.equal(
    apply(text, { insertAfter: "c();", text: " // end" }).text,
    "a();\nb();\nb();\nc(); // end\n",
  );
  assert.equal(
    apply(text, { insertBefore: "a();", text: "// start\n" }).text,
    "// start\na();\nb();\nb();\nc();\n",
  );
});

void test("match counts are checked and the messages say what to fix", () => {
  const text = "b();\nb();\n";
  assert.throws(
    () => apply(text, { oldText: "b()", newText: "x" }),
    /edits\[0\]\.oldText matched 2 times/,
  );
  assert.throws(
    () => apply(text, { oldText: "z", newText: "x" }),
    /edits\[0\]\.oldText was not found in a\.ts/,
  );
  assert.throws(
    () => apply(text, { oldText: "b()", newText: "x", all: true, count: 3 }),
    /matched 2 times in a\.ts; count is 3/,
  );
  assert.throws(
    () => apply(text, { pattern: "b", replacement: "x" }),
    /pattern matched 2 times .* without all: true/,
  );
  assert.throws(
    () => apply(text, { insertAfter: "b();", text: "x" }),
    /insertAfter matched 2 times/,
  );
  assert.throws(
    () => apply(text, { from: "b();\nb", through: "zzz", newText: "" }),
    /through was not found after/,
  );
  // A glob edit skips a file without a match.
  assert.deepEqual(apply(text, { oldText: "z", newText: "x" }, true), {
    text,
    matches: 0,
  });
  assert.throws(
    () => parseEdit({ oldText: "a", newText: "b", count: 2 }, 0, []),
    /count needs all: true/,
  );
  assert.throws(
    () => parseEdit({ oldText: "a", replacement: "b" }, 0, []),
    /unknown field replacement/,
  );
  assert.throws(
    () => parseEdit({ from: "a", newText: "" }, 0, []),
    /exactly one of through .* or upTo/,
  );
  assert.throws(
    () => parseEdit({ pattern: "(", replacement: "" }, 0, []),
    /not a valid regular expression/,
  );
});

void test("files.list and files.search return cwd-relative paths and are checked as find and grep", async () => {
  const { authorized, run } = await workspace({
    "src/a.ts": "export const one = 1;\n",
    "src/deep/b.ts": "const two = one + 1;\n",
    "notes.md": "one\n",
  });
  const lines = await run(`
    console.log(JSON.stringify((await files.list("*.ts")).sort()));
    console.log(JSON.stringify(await files.search({ pattern: "one", glob: "*.ts", literal: true })));
    console.log(JSON.stringify(await files.list({ glob: "*", limit: 1 })));
  `);
  assert.deepEqual(JSON.parse(lines[0]), ["src/a.ts", "src/deep/b.ts"]);
  assert.deepEqual(
    (JSON.parse(lines[1]) as { path: string }[]).map((m) => m.path).sort(),
    ["src/a.ts", "src/deep/b.ts"],
  );
  assert.equal((JSON.parse(lines[2]) as string[]).length, 1);
  assert.ok(
    lines.some((line) => /files\.list: showing the first 1 of 3/.test(line)),
  );
  assert.deepEqual(
    authorized.map((r) => r.toolName),
    ["find", "grep", "find"],
  );
});

void test("files.edit changes several files in order, all or nothing, and reports them", async () => {
  const { cwd, authorized, run, read } = await workspace({
    "src/a.ts": "fetchUser(1);\r\nfetchUser(2);\r\n",
    "src/b.ts": "export function fetchUser(id) {}\n",
    "src/c.ts": "unrelated\n",
  });
  const lines = await run(`
    const result = await files.edit({
      edits: [
        { glob: "src/*.ts", oldText: "fetchUser(", newText: "loadUser(", all: true },
        { path: "src/b.ts", insertBefore: "export function loadUser(", text: "/** Loads a user. */\\n" },
      ],
    });
    console.log(JSON.stringify(result.files));
    console.log(result.diff.split("\\n")[0]);
    try {
      await files.edit({ edits: [
        { path: "src/c.ts", oldText: "unrelated", newText: "changed" },
        { path: "src/a.ts", oldText: "missing", newText: "x" },
      ] });
    } catch (e) { console.log(e.code, e.message); }
    const dry = await files.edit({ dryRun: true, edits: [{ path: "src/c.ts", pattern: /un(\\w+)/, replacement: "$1" }] });
    console.log(dry.dryRun, dry.diff.includes("+related"));
  `);
  assert.deepEqual(JSON.parse(lines[0]), [
    {
      path: "src/a.ts",
      changed: true,
      added: 2,
      removed: 2,
      edits: [{ index: 0, matches: 2 }],
    },
    {
      path: "src/b.ts",
      changed: true,
      added: 2,
      removed: 1,
      edits: [
        { index: 0, matches: 1 },
        { index: 1, matches: 1 },
      ],
    },
  ]);
  assert.equal(lines[1], "--- src/a.ts");
  assert.match(
    lines[2],
    /^BAD_REQUEST edits\[1\]\.oldText was not found in src\/a\.ts/,
  );
  assert.ok(lines.includes("true true"));
  // Line endings are kept; the failed call wrote nothing.
  assert.equal(await read("src/a.ts"), "loadUser(1);\r\nloadUser(2);\r\n");
  assert.equal(
    await read("src/b.ts"),
    "/** Loads a user. */\nexport function loadUser(id) {}\n",
  );
  assert.equal(await read("src/c.ts"), "unrelated\n");
  assert.ok(
    lines.some((line) =>
      /^Updated: file src\/a\.ts, file src\/b\.ts$/.test(line),
    ),
  );
  // The first call checks every file the glob matched as the edit tool, c.ts too.
  assert.deepEqual(
    authorized
      .filter((r) => r.toolName === "edit")
      .slice(0, 3)
      .map((r) => r.args.path)
      .sort(),
    ["src/a.ts", "src/b.ts", "src/c.ts"].map((p) => join(cwd, p)),
  );
});

void test("a long diff is cut and saved whole as an artifact", async () => {
  const { root, run } = await workspace({
    "big.txt": Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n"),
  });
  const lines = await run(`
    const result = await files.edit({ edits: [{ path: "big.txt", pattern: "line", replacement: "row", all: true }] });
    console.log(result.diffFile, result.diff.length < 9000);
  `);
  assert.equal(lines[0], "artifact:edit-1.diff true");
  assert.deepEqual(await readdir(join(root, "conversation", "quick-script")), [
    "edit-1.diff",
  ]);
});

void test("edits inherit the call's target, a g flag replaces all, and a range without newText is deleted", async () => {
  const { run, read } = await workspace({
    "src/a.ts": "fetchUser(1); fetchUser(2);\n// start\nold\n// end\nkeep\n",
    "src/b.ts": "fetchUser(3);\n",
  });
  const lines = await run(`
    await files.edit({
      glob: "src/*.ts",
      edits: [
        { pattern: /\\bfetchUser\\b/g, replacement: "loadUser", count: 3 },
        { path: "src/a.ts", from: "// start", through: "// end\\n" },
      ],
    })
  `);
  // The result of the last expression prints as one line per file; the run states each edit's total.
  assert.deepEqual(lines, [
    "src/a.ts +1 -4: [0] 2, [1] 1",
    "src/b.ts +1 -1: [0] 1",
    "Updated: file src/a.ts, file src/b.ts",
    "Edit matches: [0] 3 in 2 files, [1] 1 in 1 file",
  ]);
  assert.equal(await read("src/a.ts"), "loadUser(1); loadUser(2);\nkeep\n");
  const failed = await run(
    `try { await files.edit({ edits: [{ oldText: "a", newText: "b" }] }) } catch (e) { console.log(e.message.split(" Declaration:")[0]) }`,
  );
  assert.equal(
    failed[0],
    "edits[0] needs a path or glob, on the edit or on the call.",
  );
});

void test("transform rewrites whole files, all or nothing, and keeps line endings", async () => {
  const { run, read, authorized } = await workspace({
    "src/a.ts": "one(1);\r\n",
    "src/b.ts": "one(2);\n",
    "src/c.ts": "other\n",
  });
  const lines = await run(`
    await files.edit({
      glob: "src/*.ts",
      transform: (text, path) => path.endsWith("c.ts") ? undefined : text.replace(/one\\((\\d)\\)/g, (_, n) => "two(" + n * 2 + ")"),
    })
  `);
  assert.deepEqual(lines, [
    "src/a.ts +1 -1",
    "src/b.ts +1 -1",
    "Updated: file src/a.ts, file src/b.ts",
    "Transform: 2 files changed",
  ]);
  assert.equal(await read("src/a.ts"), "two(2);\r\n");
  assert.equal(await read("src/b.ts"), "two(4);\n");
  // Every file the glob matched is checked as the edit tool before the function sees its text.
  assert.equal(authorized.filter((r) => r.toolName === "edit").length, 5);
  const bad = await run(
    `await files.edit({ path: "src/c.ts", edits: [{ pattern: /o/, replacement: (m) => m }] })`,
  );
  assert.match(
    bad[0],
    /^BAD_REQUEST: files\.edit: edits\[0\]\.replacement must be a string\. For a computed replacement use transform/,
  );
  const mixed = await run(
    `await files.edit({ path: "src/c.ts", transform: (t) => t, edits: [] })`,
  );
  assert.match(
    mixed[0],
    /^BAD_REQUEST: transform cannot be combined with edits/,
  );
});

void test("a count mismatch names the files that matched; a wide edit prints a capped summary", async () => {
  const { run } = await workspace(
    Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`many/f${i}.ts`, "old(1);\n"]),
    ),
  );
  const failed = await run(
    `await files.edit({ glob: "many/f[12].ts", edits: [{ oldText: "old(", newText: "new(", all: true, count: 3 }] })`,
  );
  assert.equal(
    failed[0],
    'BAD_REQUEST: edits[0] matched 2 times across glob "many/f[12].ts" (many/f1.ts 1, many/f2.ts 1); count is 3.',
  );
  // The uncaught error is not repeated as a failed call.
  assert.ok(!failed.some((line) => line.startsWith("Failed:")));
  const lines = await run(
    `await files.edit({ glob: "many/*.ts", edits: [{ oldText: "old(", newText: "new(", all: true }] })`,
  );
  assert.equal(lines[19], "many/f26.ts +1 -1: [0] 1");
  assert.equal(lines[20], "[+10 more files: result.files]");
  assert.equal(lines.at(-1), "Edit matches: [0] 30 in 30 files");
});

void test("a dry run prints the diff; a caught failure the script printed is not listed again; no match is not an argument error", async () => {
  const { run } = await workspace({ "a.ts": "one\none\n" });
  const dry = await run(
    `await files.edit({ path: "a.ts", dryRun: true, edits: [{ oldText: "one", newText: "two", all: true }] })`,
  );
  assert.equal(dry[0], "a.ts +2 -2: [0] 2");
  assert.equal(dry[1], "--- a.ts");
  assert.equal(
    dry.at(-1),
    "Dry run, nothing written. Edit matches: [0] 2 in 1 file",
  );
  const caught = await run(
    `try { await files.edit({ path: "a.ts", edits: [{ oldText: "one", newText: "two" }] }) } catch (e) { console.log(e.message) }`,
  );
  assert.match(caught[0], /edits\[0\]\.oldText matched 2 times/);
  assert.ok(!caught.some((line) => line.startsWith("Failed:")));
  // A swallowed failure of a write is still named.
  const swallowed = await run(
    `try { await files.edit({ path: "a.ts", edits: [{ oldText: "one", newText: "two" }] }) } catch {}`,
  );
  assert.match(swallowed[0], /^Failed: files\.edit/);
  const none = await run(
    `await files.edit({ glob: "*.nope", edits: [{ oldText: "a", newText: "b" }] })`,
  );
  assert.equal(none[0], 'NOT_FOUND: glob "*.nope" matches no files.');
});
