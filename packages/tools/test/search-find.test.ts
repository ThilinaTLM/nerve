import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
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

  it("rejects missing find paths with actionable errors", async () => {
    const project = await createTempProject();
    await assert.rejects(
      executeFind({ path: "missing", pattern: "*.ts" }, { cwd: project.root }),
      /find path not found: "missing"/,
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
console.log(root + "/src/file.ts:2:needle here");
console.log(root + "/src/file.ts-1-context line");
console.log(root + "/other.ts:4:another needle");
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
    });
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
if (!process.argv.includes("--with-filename")) process.exit(2);
console.log(target + ":1:needle here");
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
