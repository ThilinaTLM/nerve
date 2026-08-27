import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ToolExecutionError } from "../src/execution/common/tool-error.js";
import { executeEdit } from "../src/execution/filesystem/edit.js";
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
  it("applies multiple unique exact edits against original content", async () => {
    const project = await createTempProject();
    await project.write("sample.txt", "alpha\nbeta\ngamma\n");

    const result = await executeEdit(
      {
        path: "sample.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "gamma", newText: "GAMMA" },
        ],
      },
      { cwd: project.root },
    );

    assert.equal(
      await readFile(join(project.root, "sample.txt"), "utf8"),
      "ALPHA\nbeta\nGAMMA\n",
    );
    assert.equal(result.details?.operationCount, 2);
    assert.equal(result.details?.firstChangedLine, 1);
    assert.match(String(result.details?.diff), /-alpha/);
    assert.equal(result.details?.dryRun, undefined);
    assert.deepEqual(
      (result.details?.operations as Array<Record<string, unknown>>).map(
        ({ source, type, matchedBy }) => ({ source, type, matchedBy }),
      ),
      [
        { source: "edits", type: "replace_text", matchedBy: "unique" },
        { source: "edits", type: "replace_text", matchedBy: "unique" },
      ],
    );
  });

  it("supports insertion and deletion through exact replacements", async () => {
    const project = await createTempProject();
    await project.write("sample.txt", "first\nremove\nlast\n");
    await executeEdit(
      {
        path: "sample.txt",
        edits: [
          { oldText: "first\n", newText: "first\ninserted\n" },
          { oldText: "remove\n", newText: "" },
        ],
      },
      { cwd: project.root },
    );
    assert.equal(
      await readFile(join(project.root, "sample.txt"), "utf8"),
      "first\ninserted\nlast\n",
    );
  });

  it("rejects missing and ambiguous exact text with actionable errors", async () => {
    const project = await createTempProject();
    await project.write("sample.txt", "same\nother\nsame\n");
    const missing = await rejectsWithCode(
      executeEdit(
        {
          path: "sample.txt",
          edits: [{ oldText: "missing", newText: "value" }],
        },
        { cwd: project.root },
      ),
      "EDIT_MATCH_NOT_FOUND",
    );
    assert.match(missing.message, /Reread the file/);

    const ambiguous = await rejectsWithCode(
      executeEdit(
        {
          path: "sample.txt",
          edits: [{ oldText: "same", newText: "value" }],
        },
        { cwd: project.root },
      ),
      "EDIT_MATCH_AMBIGUOUS",
    );
    assert.match(ambiguous.message, /surrounding context/);
  });

  it("rejects overlapping edits before writing", async () => {
    const project = await createTempProject();
    const path = await project.write("sample.txt", "abcdef\n");
    await rejectsWithCode(
      executeEdit(
        {
          path: "sample.txt",
          edits: [
            { oldText: "abcd", newText: "one" },
            { oldText: "cdef", newText: "two" },
          ],
        },
        { cwd: project.root },
      ),
      "EDIT_OVERLAP",
    );
    assert.equal(await readFile(path, "utf8"), "abcdef\n");
  });

  it("rejects no-op edits", async () => {
    const project = await createTempProject();
    await project.write("sample.txt", "same\n");
    await rejectsWithCode(
      executeEdit(
        {
          path: "sample.txt",
          edits: [{ oldText: "same", newText: "same" }],
        },
        { cwd: project.root },
      ),
      "EDIT_NO_CHANGE",
    );
  });

  it("rejects empty arrays and legacy fields", async () => {
    const project = await createTempProject();
    await project.write("sample.txt", "value\n");
    await rejectsWithCode(
      executeEdit({ path: "sample.txt", edits: [] }, { cwd: project.root }),
      "EDIT_ARGUMENT_INVALID",
    );
    await rejectsWithCode(
      executeEdit(
        {
          path: "sample.txt",
          replacements: [{ oldText: "value", newText: "VALUE" }],
        },
        { cwd: project.root },
      ),
      "EDIT_ARGUMENT_INVALID",
    );
  });

  it("rejects binary files", async () => {
    const project = await createTempProject();
    await project.write("sample.bin", "abc\0def");
    await rejectsWithCode(
      executeEdit(
        {
          path: "sample.bin",
          edits: [{ oldText: "abc", newText: "ABC" }],
        },
        { cwd: project.root },
      ),
      "EDIT_BINARY_FILE",
    );
  });

  it("preserves UTF-8 BOM and CRLF endings", async () => {
    const project = await createTempProject();
    const path = await project.write("sample.txt", "\uFEFFone\r\ntwo\r\n");
    await executeEdit(
      {
        path: "sample.txt",
        edits: [{ oldText: "one\ntwo", newText: "ONE\nTWO" }],
      },
      { cwd: project.root },
    );
    assert.equal(await readFile(path, "utf8"), "\uFEFFONE\r\nTWO\r\n");
  });
});
