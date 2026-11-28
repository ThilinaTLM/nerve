import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  editStatLabel,
  editStatParts,
  splitEditDiff,
} from "./quick-script-calls";

const edit = { files: 2, added: 5, removed: 3, diff: "" };

describe("edit statistic", () => {
  it("counts files and lines", () => {
    assert.deepEqual(editStatParts(edit), {
      files: "2 files",
      added: "+5",
      removed: "−3",
      dryRun: false,
    });
    assert.equal(editStatParts({ ...edit, files: 1 }).files, "1 file");
    assert.equal(editStatLabel(edit), "2 files changed, 5 added, 3 removed");
  });

  it("marks a dry run", () => {
    assert.equal(editStatParts({ ...edit, dryRun: true }).dryRun, true);
    assert.match(editStatLabel({ ...edit, dryRun: true }), /, dry run$/);
  });
});

describe("splitEditDiff", () => {
  it("splits the combined diff per file, without the headers", () => {
    const diff = [
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "--- src/b.ts",
      "+++ src/b.ts",
      "@@ -3 +3 @@",
      "-x",
      "+y",
    ].join("\n");
    assert.deepEqual(splitEditDiff(diff), {
      files: [
        { path: "src/a.ts", diff: "@@ -1,2 +1,2 @@\n keep\n-old\n+new" },
        { path: "src/b.ts", diff: "@@ -3 +3 @@\n-x\n+y" },
      ],
      cut: false,
    });
  });

  it("keeps changed lines that look like a file header in their hunk", () => {
    const diff = [
      "--- notes.md",
      "+++ notes.md",
      "@@ -1,1 +1,1 @@",
      "--- old rule",
      "+++ new rule",
    ].join("\n");
    const { files } = splitEditDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.diff, "@@ -1,1 +1,1 @@\n--- old rule\n+++ new rule");
  });

  it("drops the truncation note and reports the cut", () => {
    const diff =
      "--- a\n+++ a\n@@ -1,40 +1,40 @@\n-one\n+uno\n[diff truncated; full diff: artifact:edit-1.diff]";
    const { files, cut } = splitEditDiff(diff);
    assert.equal(cut, true);
    assert.equal(files[0]?.diff, "@@ -1,40 +1,40 @@\n-one\n+uno");
    assert.equal(
      splitEditDiff("--- a\n+++ a\n@@ -1 +1 @@\n-a\n[diff truncated]").cut,
      true,
    );
  });

  it("keeps a diff without file headers as one unnamed file", () => {
    assert.deepEqual(splitEditDiff("@@ -1 +1 @@\n-a\n+b").files, [
      { path: "", diff: "@@ -1 +1 @@\n-a\n+b" },
    ]);
    assert.deepEqual(splitEditDiff("").files, []);
  });
});
