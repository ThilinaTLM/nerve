import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { builtinSkillFilePath } from "@nervekit/skills";
import { readSinglePageRow } from "../../src/execution/confluence/page-file.js";
import { ToolExecutionError } from "../../src/execution/errors/tool-error.js";

test("invalid and multi-page publishing files retain usage codes and point to the guide", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "confluence-guide-"));
  try {
    const guide = builtinSkillFilePath("confluence");
    assert.ok(guide);
    for (const [name, text, code] of [
      ["invalid.json", "not JSON", "CONFLUENCE_PAGE_FILE_INVALID_JSON"],
      ["array.json", "[]", "CONFLUENCE_PAGE_FILE_INVALID"],
      ["empty.jsonl", "", "CONFLUENCE_PAGE_FILE_EMPTY"],
      ["many.jsonl", "{}\n{}\n", "CONFLUENCE_PAGE_FILE_AMBIGUOUS"],
    ]) {
      await writeFile(join(cwd, name), text);
      await assert.rejects(readSinglePageRow(cwd, name), (error: unknown) => {
        assert.ok(error instanceof ToolExecutionError);
        assert.equal(error.code, code);
        assert.ok(error.message.endsWith(`See ${guide}.`));
        return true;
      });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
