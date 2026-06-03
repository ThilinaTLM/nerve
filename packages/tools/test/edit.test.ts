import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  executeEdit,
  normalizeEditOperations,
} from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

describe("edit executor", () => {
  it("normalizes array and legacy single-edit arguments", () => {
    assert.deepEqual(
      normalizeEditOperations({ edits: [{ oldText: "a", newText: "b" }] }),
      [{ oldText: "a", newText: "b" }],
    );
    assert.deepEqual(normalizeEditOperations({ oldText: "x", newText: "y" }), [
      { oldText: "x", newText: "y" },
    ]);
  });

  it("rejects invalid edit operation shapes", () => {
    assert.throws(() => normalizeEditOperations({ edits: [] }), /at least one/);
    assert.throws(
      () => normalizeEditOperations({ edits: [null] }),
      /edits\[0\] must be an object/,
    );
    assert.throws(
      () => normalizeEditOperations({ edits: [{ oldText: "", newText: "x" }] }),
      /oldText.*non-empty string/,
    );
    assert.throws(
      () => normalizeEditOperations({ edits: [{ oldText: "x", newText: 1 }] }),
      /newText.*string/,
    );
    assert.throws(
      () => normalizeEditOperations({ oldText: "", newText: "x" }),
      /oldText/,
    );
    assert.throws(
      () => normalizeEditOperations({ oldText: "x", newText: 1 }),
      /newText/,
    );
  });

  it("applies one replacement and multiple original-file disjoint replacements", async () => {
    const project = await createTempProject();
    await project.write("example.txt", "alpha\nbeta\ngamma\n");

    const single = await executeEdit(
      { path: "example.txt", oldText: "beta", newText: "BETA" },
      { cwd: project.root },
    );
    assert.equal(single.path, join(project.root, "example.txt"));
    assert.equal(single.content, "Edited file with 1 replacement(s).");
    assert.equal(
      await readFile(single.path ?? "", "utf8"),
      "alpha\nBETA\ngamma\n",
    );

    await executeEdit(
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

  it("preserves CRLF line endings and UTF-8 BOM", async () => {
    const project = await createTempProject();
    const path = await project.write("crlf.txt", "\uFEFFalpha\r\nbeta\r\n");

    await executeEdit(
      { path: "crlf.txt", oldText: "beta", newText: "BETA" },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "\uFEFFalpha\r\nBETA\r\n");
  });

  it("rejects no-op edits", async () => {
    const project = await createTempProject();
    await project.write("noop.txt", "same\n");

    await assert.rejects(
      executeEdit(
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
      executeEdit(
        { path: "target.txt", oldText: "missing", newText: "x" },
        { cwd: project.root },
      ),
      /was not found/,
    );

    await assert.rejects(
      executeEdit(
        { path: "target.txt", oldText: "one", newText: "ONE" },
        { cwd: project.root },
      ),
      /matched more than once/,
    );

    await assert.rejects(
      executeEdit(
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
