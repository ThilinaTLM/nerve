import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { walkFiles } from "../src/execution/common/search-utils.js";
import { executeFind, executeGrep } from "../src/execution/index.js";
import { createTempProject, withPath, writeExecutable } from "./helpers.js";

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

  it("rejects missing and non-directory find paths with actionable errors", async () => {
    const project = await createTempProject();
    await project.write("file.ts", "content");
    await assert.rejects(
      executeFind({ path: "missing", pattern: "*.ts" }, { cwd: project.root }),
      /find path not found: "missing"/,
    );
    await assert.rejects(
      executeFind({ path: "file.ts", pattern: "*.ts" }, { cwd: project.root }),
      /find path is not a directory/,
    );
  });

  it("uses fd fast path with file-only semantics", async () => {
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

  it("caps overlong find result lines while preserving structured entries", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    await writeExecutable(
      bin,
      "fd",
      `
const root = process.argv.at(-1);
console.log(root + "/" + "a".repeat(6000) + ".ts");
`,
    );

    await withPath(bin, async () => {
      const result = await executeFind(
        { path: ".", pattern: "*.ts", limit: 10 },
        { cwd: project.root },
      );
      assert.equal(result.entries?.[0]?.path.length, 6003);
      assert.ok((result.content ?? "").length < 5000);
      assert.match(result.content ?? "", /truncated/);
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

  it("searches multiple grep paths with fallback implementation", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write("a.ts", "needle in root\n");
    await project.write("nested/b.ts", "needle in nested\n");
    await project.write("ignored/c.ts", "needle ignored\n");

    await withPath(bin, async () => {
      const result = await executeGrep(
        { paths: ["a.ts", "nested"], pattern: "needle", limit: 10 },
        { cwd: project.root },
      );
      assert.equal(result.path, project.root);
      assert.deepEqual(result.matches, [
        { path: "a.ts", line: 1, text: "needle in root" },
        { path: "nested/b.ts", line: 1, text: "needle in nested" },
      ]);
    });
  });

  it("rejects space-separated grep path strings with actionable guidance", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeGrep(
        { path: "a.ts b.ts", pattern: "needle" },
        { cwd: project.root },
      ),
      /grep path not found: "a\.ts b\.ts".*multiple paths as 'paths'/,
    );
  });

  it("greps a single file with fallback implementation", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write("src/file.ts", "needle here\n");

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: "src/file.ts", pattern: "needle" },
        { cwd: project.root },
      );
      assert.equal(result.path, join(project.root, "src"));
      assert.deepEqual(result.matches, [
        { path: "file.ts", line: 1, text: "needle here" },
      ]);
    });
  });

  it("caps overlong grep match text in content and structured matches", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write(
      "src/long.ts",
      `${"x".repeat(3000)}needle${"y".repeat(3000)}\n`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: "src/long.ts", pattern: "needle" },
        { cwd: project.root },
      );
      assert.equal(result.matches?.[0]?.line, 1);
      assert.ok((result.matches?.[0]?.text ?? "").length < 700);
      assert.match(result.matches?.[0]?.text ?? "", /truncated/);
      assert.match(result.content ?? "", /matching line\(s\) truncated/);
    });
  });

  it("parses rg fast-path output into relative matches", async () => {
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

  it("defaults blank find and grep paths to the current directory", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write("root.ts", "needle\n");

    await withPath(bin, async () => {
      const found = await executeFind(
        { path: "  ", pattern: "*.ts" },
        { cwd: project.root },
      );
      assert.deepEqual(found.entries, [{ path: "root.ts", kind: "file" }]);
      const grepped = await executeGrep(
        { path: "\t", pattern: "needle" },
        { cwd: project.root },
      );
      assert.deepEqual(grepped.matches, [
        { path: "root.ts", line: 1, text: "needle" },
      ]);
      await assert.rejects(
        executeGrep(
          { paths: ["root.ts", "  "], pattern: "needle" },
          { cwd: project.root },
        ),
        /paths.*non-empty array of strings/,
      );
    });
  });

  it("skips symlinks and tolerates nested entries that disappear", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write("real/inside.ts", "content");
    await symlink(join(project.root, "real"), join(project.root, "linked"));

    await withPath(bin, async () => {
      const found = await executeFind(
        { path: ".", pattern: "**/*.ts" },
        { cwd: project.root },
      );
      assert.deepEqual(found.entries, [
        { path: "real/inside.ts", kind: "file" },
      ]);
    });

    const vanished = join(project.root, "vanished.ts");
    await project.write("vanished.ts", "content");
    await rm(vanished);
    await walkFiles(
      project.root,
      vanished,
      10,
      async () => assert.fail("vanished nested file must not be visited"),
      undefined,
      true,
    );
  });

  it("streams fallback files larger than one MiB and renders context", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "empty-bin");
    await mkdir(bin);
    await project.write(
      "large.log",
      `${"padding line\n".repeat(90_000)}before\nneedle\nafter\n`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: "large.log", pattern: "needle", context: 1 },
        { cwd: project.root },
      );
      assert.equal(result.matches?.length, 1);
      assert.match(result.content ?? "", /large\.log-90001- before/);
      assert.match(result.content ?? "", /large\.log:90002: needle/);
      assert.match(result.content ?? "", /large\.log-90003- after/);
    });
  });

  it("treats ripgrep exit code 1 as no matches without fallback rescanning", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    const marker = join(project.root, "rg-called.txt");
    await project.write("would-match.txt", "needle\n");
    await writeExecutable(
      bin,
      "rg",
      `require("node:fs").appendFileSync(${JSON.stringify(marker)}, "called\\n"); process.exit(1);`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: ".", pattern: "needle" },
        { cwd: project.root },
      );
      assert.deepEqual(result.matches, []);
      assert.equal(result.content, "No matches found.");
    });
    assert.equal(await readFile(marker, "utf8"), "called\n");
  });

  it("bounds high-volume ripgrep output at the requested global limit", async () => {
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

  it("parses colon-containing filenames from ripgrep JSON", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    await writeExecutable(
      bin,
      "rg",
      `
const root = process.argv.at(-1);
console.log(JSON.stringify({
  type: "match",
  data: { path: { text: root + "/a:b.ts" }, lines: { text: "needle\\n" }, line_number: 7 }
}));
`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: ".", pattern: "needle" },
        { cwd: project.root },
      );
      assert.deepEqual(result.matches, [
        { path: "a:b.ts", line: 7, text: "needle" },
      ]);
    });
  });

  it("aborts ripgrep and waits for child-process cleanup", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    const marker = join(project.root, "rg-signal.txt");
    await writeExecutable(
      bin,
      "rg",
      `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(marker)}, "started");
process.on("SIGTERM", () => {
  fs.appendFileSync(${JSON.stringify(marker)}, "\\nstopped");
  process.exit(0);
});
setInterval(() => {}, 1000);
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

  it("times out ripgrep and cleans up the child process", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    const marker = join(project.root, "rg-timeout.txt");
    await writeExecutable(
      bin,
      "rg",
      `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(marker)}, "started");
process.on("SIGTERM", () => {
  fs.appendFileSync(${JSON.stringify(marker)}, "\\nstopped");
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
    );
    const pending = withPath(bin, () =>
      executeGrep({ path: ".", pattern: "needle" }, { cwd: project.root }),
    );
    for (;;) {
      const started = await readFile(marker, "utf8").catch(() => undefined);
      if (started === "started") break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    context.mock.timers.tick(30_000);
    await assert.rejects(pending, /timed out/);
    assert.equal(await readFile(marker, "utf8"), "started\nstopped");
    context.mock.timers.reset();
  });

  it("greps a single file with rg fast path", async () => {
    const project = await createTempProject();
    const bin = join(project.root, "bin");
    await mkdir(bin);
    await project.write("src/file.ts", "needle here\n");
    await writeExecutable(
      bin,
      "rg",
      `
const target = process.argv.at(-1);
if (!process.argv.includes("--json")) process.exit(2);
console.log(JSON.stringify({
  type: "match",
  data: { path: { text: target }, lines: { text: "needle here\\n" }, line_number: 1 }
}));
`,
    );

    await withPath(bin, async () => {
      const result = await executeGrep(
        { path: "src/file.ts", pattern: "needle" },
        { cwd: project.root },
      );
      assert.equal(result.path, join(project.root, "src"));
      assert.deepEqual(result.matches, [
        { path: "file.ts", line: 1, text: "needle here" },
      ]);
    });
  });
});
