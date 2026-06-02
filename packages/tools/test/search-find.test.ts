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
});
