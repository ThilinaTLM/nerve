import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  executeEdit,
  normalizeEditArgs,
  ToolExecutionError,
} from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

function resultDiff(result: Awaited<ReturnType<typeof executeEdit>>): string {
  const details = result.details as { diff?: unknown } | undefined;
  assert.equal(typeof details?.diff, "string");
  return details.diff;
}

function resultDetails(
  result: Awaited<ReturnType<typeof executeEdit>>,
): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<ToolExecutionError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ToolExecutionError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected ${code}`);
}

describe("edit executor", () => {
  it("normalizes convenience and JSON-string operations", () => {
    assert.deepEqual(
      normalizeEditArgs({ oldText: "a", newText: "b" }).operations,
      [
        {
          type: "replace_text",
          oldText: "a",
          newText: "b",
          matchMode: "exact",
        },
      ],
    );
    assert.deepEqual(
      normalizeEditArgs({ patch: "@@ -1 +1 @@\n-a\n+b\n" }).operations,
      [{ type: "apply_patch", patch: "@@ -1 +1 @@\n-a\n+b\n" }],
    );
    assert.deepEqual(
      normalizeEditArgs({
        operations: JSON.stringify([
          { type: "insert_lines", line: 1, position: "before", text: "x\n" },
        ]),
      }).operations,
      [{ type: "insert_lines", line: 1, position: "before", text: "x\n" }],
    );
  });

  it("rejects invalid operation shapes", () => {
    assert.throws(
      () => normalizeEditArgs({ operations: [] }),
      /at least one operation/,
    );
    assert.throws(
      () => normalizeEditArgs({ operations: [null] }),
      /must be an object/,
    );
    assert.throws(
      () =>
        normalizeEditArgs({
          operations: [{ type: "replace_text", oldText: "", newText: "x" }],
        }),
      /oldText.*non-empty/,
    );
    assert.throws(
      () =>
        normalizeEditArgs({
          operations: [
            { type: "insert_lines", line: 0, position: "after", text: "x" },
          ],
        }),
      /line.*positive integer/,
    );
    assert.throws(
      () =>
        normalizeEditArgs({
          operations: [
            { type: "replace_text", oldText: "a", newText: "b", note: "bad" },
          ],
        }),
      /unsupported field/,
    );
  });

  it("applies exact text operations and records operation metadata", async () => {
    const project = await createTempProject();
    const path = await project.write("example.txt", "alpha\nbeta\ngamma\n");

    const result = await executeEdit(
      {
        path: "example.txt",
        operations: [
          { type: "replace_text", oldText: "beta", newText: "BETA" },
          {
            type: "insert_text",
            anchor: "gamma\n",
            position: "before",
            text: "inserted\n",
          },
        ],
      },
      { cwd: project.root },
    );

    assert.equal(result.path, join(project.root, "example.txt"));
    assert.equal(
      await readFile(path, "utf8"),
      "alpha\nBETA\ninserted\ngamma\n",
    );
    assert.match(resultDiff(result), /\+inserted/);
    const details = resultDetails(result);
    assert.equal(details.operationCount, 2);
    assert.equal(details.dryRun, false);
  });

  it("supports dry-run previews without writing", async () => {
    const project = await createTempProject();
    const path = await project.write("preview.txt", "one\ntwo\n");

    const result = await executeEdit(
      {
        path: "preview.txt",
        dryRun: true,
        operations: [{ type: "replace_text", oldText: "two", newText: "TWO" }],
      },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "one\ntwo\n");
    assert.match(result.content ?? "", /Previewed edit/);
    assert.match(resultDiff(result), /\+TWO/);
    assert.equal(resultDetails(result).dryRun, true);
  });

  it("requires unique matches unless occurrence is supplied", async () => {
    const project = await createTempProject();
    await project.write("dupe.txt", "one\ntwo\none\n");

    const ambiguous = await rejectsWithCode(
      executeEdit(
        {
          path: "dupe.txt",
          operations: [
            { type: "replace_text", oldText: "one", newText: "ONE" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_MATCH_AMBIGUOUS",
    );
    assert.match(ambiguous.message, /matched 2 times/);
    assert.match(ambiguous.message, /occurrence to 1\.\.2/);

    await executeEdit(
      {
        path: "dupe.txt",
        operations: [
          {
            type: "replace_text",
            oldText: "one",
            newText: "ONE",
            occurrence: 2,
          },
        ],
      },
      { cwd: project.root },
    );
    assert.equal(
      await readFile(join(project.root, "dupe.txt"), "utf8"),
      "one\ntwo\nONE\n",
    );
  });

  it("reports missing-match closest candidates", async () => {
    const project = await createTempProject();
    await project.write(
      "missing.txt",
      "function start() {\n  return run();\n}\n",
    );

    const error = await rejectsWithCode(
      executeEdit(
        {
          path: "missing.txt",
          operations: [
            {
              type: "replace_text",
              oldText: "function stop() {\n  return run();\n}",
              newText: "x",
            },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_MATCH_NOT_FOUND",
    );
    assert.match(error.message, /Closest candidates/);
    assert.match(error.message, /lines 1-3/);
  });

  it("supports trimmed and whitespace match modes explicitly", async () => {
    const project = await createTempProject();
    const path = await project.write(
      "modes.txt",
      "const    value = “hello”;   \nnext();\n",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "modes.txt",
          operations: [
            {
              type: "replace_text",
              oldText: 'const value = "hello";',
              newText: 'const value = "hi";',
            },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_MATCH_NOT_FOUND",
    );

    await executeEdit(
      {
        path: "modes.txt",
        operations: [
          {
            type: "replace_text",
            oldText: 'const value = "hello";',
            newText: 'const value = "hi";',
            matchMode: "whitespace",
          },
        ],
      },
      { cwd: project.root },
    );
    assert.equal(
      await readFile(path, "utf8"),
      'const value = "hi";   \nnext();\n',
    );

    await executeEdit(
      {
        path: "modes.txt",
        operations: [
          {
            type: "replace_text",
            oldText: 'const value = "hi";   ',
            newText: 'const value = "done";',
            matchMode: "trimmed",
          },
        ],
      },
      { cwd: project.root },
    );
    assert.equal(
      await readFile(path, "utf8"),
      'const value = "done";\nnext();\n',
    );
  });

  it("supports line replacement and insertion", async () => {
    const project = await createTempProject();
    const path = await project.write("lines.txt", "one\ntwo\nthree\n");

    await executeEdit(
      {
        path: "lines.txt",
        operations: [
          { type: "replace_lines", startLine: 2, endLine: 2, newText: "TWO\n" },
          { type: "insert_lines", line: 1, position: "before", text: "zero\n" },
          { type: "insert_lines", line: 3, position: "after", text: "four\n" },
        ],
      },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "zero\none\nTWO\nthree\nfour\n");
  });

  it("rejects overlapping operations and same-offset inserts", async () => {
    const project = await createTempProject();
    await project.write("overlap.txt", "abcdef\n");

    await rejectsWithCode(
      executeEdit(
        {
          path: "overlap.txt",
          operations: [
            { type: "replace_text", oldText: "abc", newText: "ABC" },
            { type: "replace_text", oldText: "bcd", newText: "BCD" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_OVERLAP",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "overlap.txt",
          operations: [
            { type: "insert_lines", line: 1, position: "before", text: "x\n" },
            { type: "insert_lines", line: 1, position: "before", text: "y\n" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_OVERLAP",
    );
  });

  it("applies single-file unified patches", async () => {
    const project = await createTempProject();
    const path = await project.write("patch.txt", "alpha\ngamma\n");

    await executeEdit(
      {
        path: "patch.txt",
        operations: [
          {
            type: "apply_patch",
            patch: "@@ -1,2 +1,3 @@\n alpha\n+beta\n gamma\n",
          },
        ],
      },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "alpha\nbeta\ngamma\n");
  });

  it("rejects invalid patches and mixed patch operations", async () => {
    const project = await createTempProject();
    await project.write("patch-errors.txt", "alpha\n");

    await rejectsWithCode(
      executeEdit(
        {
          path: "patch-errors.txt",
          operations: [
            { type: "apply_patch", patch: "@@ -1 +1 @@\n-alpha\n+beta\n" },
            { type: "insert_lines", line: 1, position: "after", text: "x\n" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_ARGUMENT_INVALID",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "patch-errors.txt",
          operations: [
            {
              type: "apply_patch",
              patch:
                "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-alpha\n+beta\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n",
            },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_PATCH_INVALID",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "patch-errors.txt",
          operations: [
            { type: "apply_patch", patch: "@@ -1 +1 @@\n-missing\n+beta\n" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_PATCH_APPLY_FAILED",
    );
  });

  it("preserves CRLF line endings and UTF-8 BOM", async () => {
    const project = await createTempProject();
    const path = await project.write("crlf.txt", "\uFEFFalpha\r\nbeta\r\n");

    await executeEdit(
      {
        path: "crlf.txt",
        operations: [
          { type: "replace_text", oldText: "beta", newText: "BETA" },
        ],
      },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "\uFEFFalpha\r\nBETA\r\n");
  });

  it("rejects no-op and binary-looking files", async () => {
    const project = await createTempProject();
    await project.write("noop.txt", "same\n");
    await project.write("binary.bin", "a\0b");

    await rejectsWithCode(
      executeEdit(
        {
          path: "noop.txt",
          operations: [
            { type: "replace_text", oldText: "same", newText: "same" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_NO_CHANGE",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "binary.bin",
          operations: [{ type: "replace_text", oldText: "a", newText: "A" }],
        },
        { cwd: project.root },
      ),
      "EDIT_BINARY_FILE",
    );
  });
});
