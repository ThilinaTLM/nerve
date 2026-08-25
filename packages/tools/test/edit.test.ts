import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { executeEdit } from "../src/execution/filesystem/edit.js";
import { ToolExecutionError } from "../src/execution/common/tool-error.js";
import { createTempProject } from "./helpers.js";

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
  it("requires unique matches unless occurrence is supplied", async () => {
    const project = await createTempProject();
    await project.write("dupe.txt", "one\ntwo\none\n");

    const ambiguous = await rejectsWithCode(
      executeEdit(
        {
          path: "dupe.txt",
          replacements: [{ oldText: "one", newText: "ONE" }],
        },
        { cwd: project.root },
      ),
      "EDIT_MATCH_AMBIGUOUS",
    );
    assert.match(ambiguous.message, /replacements\[0\]\.oldText/);
    assert.match(ambiguous.message, /matched 2 times/);
    assert.match(ambiguous.message, /occurrence to 1\.\.2/);

    await executeEdit(
      {
        path: "dupe.txt",
        replacements: [{ oldText: "one", newText: "ONE", occurrence: 2 }],
      },
      { cwd: project.root },
    );
    assert.equal(
      await readFile(join(project.root, "dupe.txt"), "utf8"),
      "one\ntwo\nONE\n",
    );
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
          replacements: [
            {
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
        replacements: [
          {
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
        replacements: [
          {
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

  it("rejects overlapping operations and same-offset inserts", async () => {
    const project = await createTempProject();
    await project.write("overlap.txt", "abcdef\n");

    await rejectsWithCode(
      executeEdit(
        {
          path: "overlap.txt",
          replacements: [
            { oldText: "abc", newText: "ABC" },
            { oldText: "bcd", newText: "BCD" },
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
          lineInsertions: [
            { line: 1, position: "before", text: "x\n" },
            { line: 1, position: "before", text: "y\n" },
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
        patch: "@@ -1,2 +1,3 @@\n alpha\n+beta\n gamma\n",
      },
      { cwd: project.root },
    );

    assert.equal(await readFile(path, "utf8"), "alpha\nbeta\ngamma\n");
  });

  it("rejects invalid patches and mixed patch edits", async () => {
    const project = await createTempProject();
    await project.write("patch-errors.txt", "alpha\n");

    await rejectsWithCode(
      executeEdit(
        {
          path: "patch-errors.txt",
          patch: "@@ -1 +1 @@\n-alpha\n+beta\n",
          lineInsertions: [{ line: 1, position: "after", text: "x\n" }],
        },
        { cwd: project.root },
      ),
      "EDIT_ARGUMENT_INVALID",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "patch-errors.txt",
          patch:
            "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-alpha\n+beta\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n",
        },
        { cwd: project.root },
      ),
      "EDIT_PATCH_INVALID",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "patch-errors.txt",
          patch: "@@ -1 +1 @@\n-missing\n+beta\n",
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
        replacements: [{ oldText: "beta", newText: "BETA" }],
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
          replacements: [{ oldText: "same", newText: "same" }],
        },
        { cwd: project.root },
      ),
      "EDIT_NO_CHANGE",
    );

    await rejectsWithCode(
      executeEdit(
        {
          path: "binary.bin",
          replacements: [{ oldText: "a", newText: "A" }],
        },
        { cwd: project.root },
      ),
      "EDIT_BINARY_FILE",
    );
  });
});
