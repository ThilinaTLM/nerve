import assert from "node:assert/strict";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { executeFind } from "../../src/execution/filesystem/find.js";
import { executeGrep } from "../../src/execution/filesystem/search.js";
import { executeFindWithBackend } from "../../src/execution/filesystem/find.js";
import { executeGrepWithBackend } from "../../src/execution/filesystem/search.js";
import {
  createTempProject,
  withPath,
  writeExecutable,
} from "../support/project-fixtures.js";
import { createSearchFindFixture } from "../search-find-fixtures.js";

function requireExecutableFixtures(t: TestContext): boolean {
  if (process.platform !== "win32") return true;
  t.skip("Executable fixture scripts use POSIX shebangs.");
  return false;
}

describe("find and grep executors", () => {
  it("falls back to Node find implementation and skips dependency/control directories", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write("a.txt", "a");
    await project.write("b.txt", "b");
    await project.write("node_modules/ignored.txt", "ignored");
    await project.write(".git/ignored.txt", "ignored");

    await withPath(bin, async () => {
      const result = await executeFind(
        { path: ".", pattern: "*.txt", limit: 10 },
        { cwd: project.root },
      );
      assert.deepEqual(result.entries, [
        { path: "a.txt", kind: "file" },
        { path: "b.txt", kind: "file" },
      ]);

      const limited = await executeFind(
        { path: ".", pattern: "*.txt", limit: 1 },
        { cwd: project.root },
      );
      assert.equal(limited.entries?.length, 1);
    });
  });

  it("uses fd fast path with file-only semantics", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    await writeExecutable(
      bin,
      "fd",
      `
const root = process.argv.at(-1);
const fileOnly = process.argv.includes("--type") && process.argv.includes("file");
console.log(root + "/src/main.ts");
if (!fileOnly) console.log(root + "/src");
`,
    );

    await withPath(bin, async () => {
      const result = await executeFind(
        { path: ".", pattern: "*.ts", limit: 10 },
        { cwd: project.root },
      );
      assert.deepEqual(result.entries, [{ path: "src/main.ts", kind: "file" }]);
    });
  });

  it("falls back to Node grep with regex, literal, ignore-case, glob, and limit behavior", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write("alpha.txt", "Needle here\nsecond needle\n");
    await project.write("beta.md", "needle in markdown\n");
    await project.write("gamma.txt", "literal a+b\n");

    await withPath(bin, async () => {
      const regex = await executeGrep(
        {
          path: ".",
          pattern: "needle",
          ignoreCase: true,
          glob: "*.txt",
          limit: 1,
        },
        { cwd: project.root },
      );
      assert.deepEqual(regex.matches, [
        { path: "alpha.txt", line: 1, text: "Needle here" },
      ]);

      const literal = await executeGrep(
        { path: ".", pattern: "a+b", literal: true, glob: "*.txt" },
        { cwd: project.root },
      );
      assert.deepEqual(literal.matches, [
        { path: "gamma.txt", line: 1, text: "literal a+b" },
      ]);
    });
  });

  it("parses rg fast-path output into relative matches", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    await writeExecutable(
      bin,
      "rg",
      `
const root = process.argv.at(-1);
const emit = (type, path, line, text) => console.log(JSON.stringify({
  type,
  data: { path: { text: path }, lines: { text: text + "\\n" }, line_number: line }
}));
emit("context", root + "/src/file.ts", 1, "context before");
emit("match", root + "/src/file.ts", 2, "needle here");
emit("context", root + "/src/file.ts", 3, "context after");
emit("match", root + "/other.ts", 4, "another needle");
`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: ".", pattern: "needle", context: 1, limit: 1 },
        { cwd: project.root },
      );
      assert.deepEqual(result.matches, [
        { path: "src/file.ts", line: 2, text: "needle here" },
      ]);
      assert.match(result.content ?? "", /src\/file\.ts-1- context before/);
      assert.match(result.content ?? "", /src\/file\.ts-3- context after/);
    });
  });

  it("bounds high-volume ripgrep output at the requested global limit", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    await writeExecutable(
      bin,
      "rg",
      `
const root = process.argv.at(-1);
for (let line = 1; line <= 100000; line += 1) {
  console.log(JSON.stringify({
    type: "match",
    data: { path: { text: root + "/huge.log" }, lines: { text: "needle " + line + "\\n" }, line_number: line }
  }));
}
`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: ".", pattern: "needle", limit: 3 },
        { cwd: project.root },
      );
      assert.equal(result.matches?.length, 3);
      assert.deepEqual(
        result.matches?.map((match) => match.line),
        [1, 2, 3],
      );
    });
  });

  it("aborts ripgrep and waits for child-process cleanup", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    const marker = join(project.root, "rg-signal.txt");
    await writeExecutable(
      bin,
      "rg",
      `
const fs = require("node:fs");
// Install the handler before announcing readiness so an abort that lands
// immediately after the marker appears can never hit the default SIGTERM
// disposition (the source of a macOS CI race).
process.on("SIGTERM", () => {
  fs.appendFileSync(${JSON.stringify(marker)}, "\\nstopped");
  process.exit(0);
});
setInterval(() => {}, 1000);
fs.writeFileSync(${JSON.stringify(marker)}, "started");
`,
    );
    const controller = new AbortController();
    const pending = withPath(bin, () =>
      executeGrep(
        { path: ".", pattern: "needle" },
        { cwd: project.root, signal: controller.signal },
      ),
    );
    for (;;) {
      const started = await readFile(marker, "utf8").catch(() => undefined);
      if (started === "started") break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    controller.abort();
    await assert.rejects(pending, /aborted/);
    assert.equal(await readFile(marker, "utf8"), "started\nstopped");
  });

  it("freezes Node fixture semantics", async () => {
    const project = await createTempProject();
    const fixture = await createSearchFindFixture(project.root, 3);
    const grep = await executeGrepWithBackend(
      fixture.grepCases[0]!.args,
      { cwd: fixture.root },
      "node",
    );
    const find = await executeFindWithBackend(
      fixture.findCases[0]!.args,
      { cwd: fixture.root },
      "node",
    );

    assert.deepEqual(grep.matches?.map((match) => match.path).sort(), [
      ".hidden.ts",
      "README.md",
      "src/beta.ts",
    ]);
    assert.deepEqual(find.entries?.map((entry) => entry.path).sort(), [
      "src/alpha.ts",
      "src/beta.ts",
    ]);
  });

  it("handles fixture encoding, symlinks, multiple roots, and disappearing files", async () => {
    const project = await createTempProject();
    const fixture = await createSearchFindFixture(project.root, 1);
    const edge = await executeGrepWithBackend(
      { path: "edge", pattern: "needle", literal: true },
      { cwd: fixture.root },
      "node",
    );
    assert.equal(
      edge.matches?.some((match) => match.path === "binary.bin"),
      false,
    );
    assert.equal(
      edge.matches?.some((match) => match.path === "context-link.txt"),
      false,
    );

    const multiple = await executeGrepWithBackend(
      {
        paths: ["small/src/alpha.ts", "small/src/beta.ts"],
        pattern: "needle",
        ignoreCase: true,
      },
      { cwd: fixture.root },
      "node",
    );
    assert.deepEqual(multiple.matches?.map((match) => match.path).sort(), [
      "alpha.ts",
      "beta.ts",
    ]);

    await unlink(join(fixture.root, "edge", "disappearing.txt"));
    const afterRace = await executeGrepWithBackend(
      { path: "edge", pattern: "needle", literal: true },
      { cwd: fixture.root },
      "node",
    );
    assert.equal(
      afterRace.matches?.some((match) => match.path === "disappearing.txt"),
      false,
    );
  });
});
