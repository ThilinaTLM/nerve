import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { executeFind } from "../../src/execution/filesystem/find.js";
import { executeGrep } from "../../src/execution/filesystem/search.js";
import { createTempProject } from "../support/project-fixtures.js";
import { createSearchFindFixture } from "../search-find-fixtures.js";

describe("find and grep executors", () => {
  it("reports authoritative totals beyond the producer's visible limit", async () => {
    const project = await createTempProject();
    await project.write("a.txt", "needle\nneedle\n");
    await project.write("b.txt", "needle\n");
    const grep = await executeGrep(
      { pattern: "needle", limit: 1 },
      { cwd: project.root },
    );
    assert.equal(grep.matches?.length, 1);
    assert.equal(grep.details?.totalMatches, 3);
    assert.equal(grep.details?.totalFiles, 2);
    const find = await executeFind(
      { pattern: "*.txt", limit: 1 },
      { cwd: project.root },
    );
    assert.deepEqual(find.entries, [{ path: "a.txt", kind: "file" }]);
    assert.equal(find.details?.totalEntries, 2);
  });

  it("points a cut grep line at a copyable read call", async () => {
    const project = await createTempProject();
    await project.write("a.min.js", `ok\n${"x".repeat(600)}needle\n`);
    const result = await executeGrep(
      { pattern: "needle" },
      { cwd: project.root },
    );
    // Line 2 starts at byte 3; the first 500 characters were shown.
    assert.match(
      result.content ?? "",
      /1 line cut to 500 chars\. Next: read \{"path":"a\.min\.js","byteOffset":503\}$/,
    );
  });

  it("honors ignore files, hidden files and file-only semantics in find", async () => {
    const project = await createTempProject();
    await project.write(".gitignore", "node_modules/\n");
    await project.write("a.txt", "a");
    await project.write("b.txt", "b");
    await project.write(".hidden/c.txt", "c");
    await project.write("node_modules/ignored.txt", "ignored");
    await project.write(".git/ignored.txt", "ignored");
    const result = await executeFind(
      { path: ".", pattern: "*.txt", limit: 10 },
      { cwd: project.root },
    );
    assert.deepEqual(result.entries, [
      { path: ".hidden/c.txt", kind: "file" },
      { path: "a.txt", kind: "file" },
      { path: "b.txt", kind: "file" },
    ]);
  });

  it("supports regex, literal, ignore-case, glob, and limit behavior", async () => {
    const project = await createTempProject();
    await project.write("alpha.txt", "Needle here\nsecond needle\n");
    await project.write("beta.md", "needle in markdown\n");
    await project.write("gamma.txt", "literal a+b\n");
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
    await assert.rejects(
      executeGrep({ pattern: "a(" }, { cwd: project.root }),
      /Invalid grep pattern: Unclosed group/,
    );
  });

  it("shows context around the last returned match and none beyond it", async () => {
    const project = await createTempProject();
    await project.write("a.txt", "1\nneedle\n3\nneedle\n5\n6\n");
    await project.write("b.txt", "needle\n");
    const result = await executeGrep(
      { pattern: "needle", context: 1, limit: 1 },
      { cwd: project.root },
    );
    assert.deepEqual(result.matches, [
      { path: "a.txt", line: 2, text: "needle" },
    ]);
    assert.equal(result.details?.totalMatches, 3);
    assert.equal(result.details?.totalFiles, 2);
    assert.equal(
      result.content?.split("\n").slice(0, 3).join("\n"),
      "a.txt-1- 1\na.txt:2: needle\na.txt-3- 3",
    );
    assert.doesNotMatch(result.content ?? "", /b\.txt/);
  });

  it("rejects with an abort error when the signal is already aborted", async () => {
    const project = await createTempProject();
    await project.write("a.txt", "needle\n");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      executeGrep(
        { pattern: "needle" },
        { cwd: project.root, signal: controller.signal },
      ),
      /aborted/,
    );
    await assert.rejects(
      executeFind(
        { pattern: "*" },
        { cwd: project.root, signal: controller.signal },
      ),
      /aborted/,
    );
  });

  it("fixture semantics", async () => {
    const project = await createTempProject();
    const fixture = await createSearchFindFixture(project.root, 3);
    const grep = await executeGrep(fixture.grepCases[0]!.args, {
      cwd: fixture.root,
    });
    const find = await executeFind(fixture.findCases[0]!.args, {
      cwd: fixture.root,
    });

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
    const edge = await executeGrep(
      { path: "edge", pattern: "needle", literal: true },
      { cwd: fixture.root },
    );
    assert.equal(
      edge.matches?.some((match) => match.path === "binary.bin"),
      false,
    );
    assert.equal(
      edge.matches?.some((match) => match.path === "context-link.txt"),
      false,
    );

    const multiple = await executeGrep(
      {
        paths: ["small/src/alpha.ts", "small/src/beta.ts"],
        pattern: "needle",
        ignoreCase: true,
      },
      { cwd: fixture.root },
    );
    assert.deepEqual(multiple.matches?.map((match) => match.path).sort(), [
      "alpha.ts",
      "beta.ts",
    ]);

    await unlink(join(fixture.root, "edge", "disappearing.txt"));
    const afterRace = await executeGrep(
      { path: "edge", pattern: "needle", literal: true },
      { cwd: fixture.root },
    );
    assert.equal(
      afterRace.matches?.some((match) => match.path === "disappearing.txt"),
      false,
    );
  });
});
