import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  executeLegacyEdit,
  normalizeLegacyEditOperations,
} from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

function resultDiff(
  result: Awaited<ReturnType<typeof executeLegacyEdit>>,
): string {
  const details = result.details as { diff?: unknown } | undefined;
  assert.equal(typeof details?.diff, "string");
  return details.diff;
}

function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function hunkCount(diff: string): number {
  return diff.match(/^@@ /gm)?.length ?? 0;
}

describe("legacy_edit executor", () => {
  it("normalizes array and legacy single-edit arguments", () => {
    assert.deepEqual(
      normalizeLegacyEditOperations({
        edits: [{ oldText: "a", newText: "b" }],
      }),
      [{ oldText: "a", newText: "b" }],
    );
    assert.deepEqual(
      normalizeLegacyEditOperations({ oldText: "x", newText: "y" }),
      [{ oldText: "x", newText: "y" }],
    );
  });

  it("rejects invalid edit operation shapes", () => {
    assert.throws(
      () => normalizeLegacyEditOperations({ edits: [] }),
      /at least one/,
    );
    assert.throws(
      () => normalizeLegacyEditOperations({ edits: [null] }),
      /edits\[0\] must be an object/,
    );
    assert.throws(
      () =>
        normalizeLegacyEditOperations({
          edits: [{ oldText: "", newText: "x" }],
        }),
      /oldText.*non-empty string/,
    );
    assert.throws(
      () =>
        normalizeLegacyEditOperations({
          edits: [{ oldText: "x", newText: 1 }],
        }),
      /newText.*string/,
    );
    assert.throws(
      () => normalizeLegacyEditOperations({ oldText: "", newText: "x" }),
      /oldText/,
    );
    assert.throws(
      () => normalizeLegacyEditOperations({ oldText: "x", newText: 1 }),
      /newText/,
    );
  });

  it("applies one replacement and multiple original-file disjoint replacements", async () => {
    const project = await createTempProject();
    await project.write("example.txt", "alpha\nbeta\ngamma\n");

    const single = await executeLegacyEdit(
      { path: "example.txt", oldText: "beta", newText: "BETA" },
      { cwd: project.root },
    );
    assert.equal(single.path, join(project.root, "example.txt"));
    assert.equal(single.content, "Edited file with 1 replacement(s).");
    assert.equal(diffStats(resultDiff(single)).additions, 1);
    assert.equal(diffStats(resultDiff(single)).deletions, 1);
    assert.equal(
      await readFile(single.path ?? "", "utf8"),
      "alpha\nBETA\ngamma\n",
    );

    await executeLegacyEdit(
      {
        path: "example.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "gamma", newText: "GAMMA" },
        ],
      },
      { cwd: project.root },
    );
    assert.equal(
      await readFile(single.path ?? "", "utf8"),
      "ALPHA\nBETA\nGAMMA\n",
    );
  });

  it("generates accurate unified diffs for insertions and deletions", async () => {
    const project = await createTempProject();
    await project.write("insert.txt", "alpha\nbeta\ngamma\n");

    const insertion = await executeLegacyEdit(
      {
        path: "insert.txt",
        oldText: "beta\n",
        newText: "beta\ninserted\n",
      },
      { cwd: project.root },
    );
    const insertionDiff = resultDiff(insertion);
    assert.match(insertionDiff, /^@@ -1,3 \+1,4 @@/m);
    assert.deepEqual(diffStats(insertionDiff), { additions: 1, deletions: 0 });

    await project.write("delete.txt", "alpha\nbeta\nremoved\ngamma\n");
    const deletion = await executeLegacyEdit(
      { path: "delete.txt", oldText: "removed\n", newText: "" },
      { cwd: project.root },
    );
    const deletionDiff = resultDiff(deletion);
    assert.match(deletionDiff, /^@@ -1,4 \+1,3 @@/m);
    assert.deepEqual(diffStats(deletionDiff), { additions: 0, deletions: 1 });
  });

  it("generates separate hunks for far-apart replacements", async () => {
    const project = await createTempProject();
    await project.write(
      "multi.txt",
      Array.from({ length: 12 }, (_, index) => `line${index + 1}`).join("\n") +
        "\n",
    );

    const result = await executeLegacyEdit(
      {
        path: "multi.txt",
        edits: [
          { oldText: "line1\n", newText: "LINE1\n" },
          { oldText: "line11\n", newText: "LINE11\n" },
        ],
      },
      { cwd: project.root },
    );
    const diff = resultDiff(result);
    assert.equal(hunkCount(diff), 2);
    assert.match(diff, /-line1\n\+LINE1/);
    assert.match(diff, /-line11\n\+LINE11/);
  });

  it("preserves CRLF line endings and UTF-8 BOM", async () => {
    const project = await createTempProject();
    const path = await project.write("crlf.txt", "\uFEFFalpha\r\nbeta\r\n");

    await executeLegacyEdit(
      { path: "crlf.txt", oldText: "beta", newText: "BETA" },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "\uFEFFalpha\r\nBETA\r\n");
  });

  it("rejects no-op edits", async () => {
    const project = await createTempProject();
    await project.write("noop.txt", "same\n");

    await assert.rejects(
      executeLegacyEdit(
        { path: "noop.txt", oldText: "same", newText: "same" },
        { cwd: project.root },
      ),
      /would not change/,
    );
  });

  it("rejects missing, duplicate, and overlapping oldText regions", async () => {
    const project = await createTempProject();
    await project.write("target.txt", "one two one\nabcdef\n");

    await assert.rejects(
      executeLegacyEdit(
        { path: "target.txt", oldText: "missing", newText: "x" },
        { cwd: project.root },
      ),
      /was not found/,
    );

    await assert.rejects(
      executeLegacyEdit(
        { path: "target.txt", oldText: "one", newText: "ONE" },
        { cwd: project.root },
      ),
      /matched more than once/,
    );

    await assert.rejects(
      executeLegacyEdit(
        {
          path: "target.txt",
          edits: [
            { oldText: "abc", newText: "ABC" },
            { oldText: "bcd", newText: "BCD" },
          ],
        },
        { cwd: project.root },
      ),
      /overlaps/,
    );
  });
});
