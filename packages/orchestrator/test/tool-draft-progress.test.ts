import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finalToolDraftProgress,
  ToolDraftProgressAccumulator,
} from "../src/domains/agents/run/tool-draft-progress.js";

describe("ToolDraftProgressAccumulator", () => {
  it("extracts write path and generated line count from partial JSON", () => {
    const accumulator = new ToolDraftProgressAccumulator("write");

    accumulator.push('{"path":"src/app.ts","content":"one');
    const progress = accumulator.push("\\ntwo\\nthree");

    assert.equal(progress?.path, "src/app.ts");
    assert.equal(progress?.lineCount, 3);
    assert.equal(progress?.generatedLineCount, 3);
    assert.equal(progress?.estimated, true);
  });

  it("handles split write property names and escaped newlines", () => {
    const accumulator = new ToolDraftProgressAccumulator("write");

    accumulator.push('{"pa');
    accumulator.push('th":"src/split.ts","cont');
    accumulator.push('ent":"alpha');
    const progress = accumulator.push("\\nbeta");

    assert.equal(progress?.path, "src/split.ts");
    assert.equal(progress?.lineCount, 2);
  });

  it("counts edit shorthand insertions, replacements, and patches", () => {
    const accumulator = new ToolDraftProgressAccumulator("edit");

    accumulator.push('{"path":"src/app.ts","insertions":[{"text":"a\\nb"}],');
    const progress = accumulator.push(
      '"replacements":[{"oldText":"old\\ntext","newText":"new"}],"patch":"@@ -1 +1,2 @@\\n-old\\n+new\\n+extra\\n"}',
    );

    assert.equal(progress?.path, "src/app.ts");
    assert.equal(progress?.operationCount, 3);
    assert.equal(progress?.generatedLineCount, 5);
    assert.equal(progress?.estimatedAdditions, 5);
    assert.equal(progress?.estimatedDeletions, 3);
  });

  it("never exposes raw generated content in progress snapshots", () => {
    const secretContent = "SECRET_CONTENT_SHOULD_NOT_LEAK";
    const accumulator = new ToolDraftProgressAccumulator("write");

    const progress = accumulator.push(
      `{"path":"src/secret.ts","content":"${secretContent}\\nline 2`,
    );

    assert.ok(progress);
    assert.equal(JSON.stringify(progress).includes(secretContent), false);
  });

  it("returns best-effort progress for malformed partial JSON", () => {
    const accumulator = new ToolDraftProgressAccumulator("edit");

    const progress = accumulator.push(
      '{"path":"src/app.ts","replacements":[{"oldText":"old\\ntext","newText":"new',
    );

    assert.equal(progress?.path, "src/app.ts");
    assert.equal(progress?.operationCount, 1);
    assert.equal(progress?.generatedLineCount, 1);
    assert.equal(progress?.estimatedDeletions, 2);
  });
});

describe("finalToolDraftProgress", () => {
  it("summarizes final write args without raw content", () => {
    const progress = finalToolDraftProgress("write", {
      path: "src/app.ts",
      content: "one\ntwo",
    });

    assert.deepEqual(progress, {
      path: "src/app.ts",
      lineCount: 2,
      generatedLineCount: 2,
      estimated: false,
    });
  });

  it("summarizes final edit shorthand args", () => {
    const progress = finalToolDraftProgress("edit", {
      path: "src/app.ts",
      lineInsertions: [{ line: 1, position: "before", text: "one\ntwo" }],
      replacements: [{ oldText: "old", newText: "new" }],
      patch: "@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
    });

    assert.deepEqual(progress, {
      path: "src/app.ts",
      operationCount: 3,
      generatedLineCount: 5,
      estimatedAdditions: 5,
      estimatedDeletions: 2,
      estimated: false,
    });
  });
});
