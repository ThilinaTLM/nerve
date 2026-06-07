import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveToolCallDraft } from "../stores/workbench/state.svelte";
import { summarizeToolDraft } from "./tool-draft-progress";

function draft(
  toolName: string,
  overrides: Partial<LiveToolCallDraft> = {},
): LiveToolCallDraft {
  return {
    kind: "tool_call_draft",
    key: `live:msg_1:tool-draft:0`,
    runId: "run_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    contentIndex: 0,
    providerToolCallId: "call_1",
    toolName,
    argsText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeToolDraft", () => {
  it("counts partial write content lines from escaped JSON", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"src/app.ts","content":"one\\ntwo\\nthree',
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.path, "src/app.ts");
    assert.equal(summary.lineCount, 3);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["3 lines"],
    );
  });

  it("uses final write args for exact path and line count", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"src/old.ts","content":"partial',
        args: { path: "src/final.ts", content: "one\ntwo" },
        done: true,
      }),
    );

    assert.equal(summary.path, "src/final.ts");
    assert.equal(summary.lineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 lines", "submitted"],
    );
  });

  it("counts partial edit replacements and generated lines", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        argsText:
          '{"path":"src/app.ts","edits":[{"oldText":"a","newText":"b\\nc"},{"oldText":"d","newText":"e',
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.path, "src/app.ts");
    assert.equal(summary.replacementCount, 2);
    assert.equal(summary.generatedLineCount, 3);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 replacements", "3 generated lines"],
    );
  });

  it("uses final edit args for exact replacement and generated-line counts", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        args: {
          path: "src/app.ts",
          edits: [
            { oldText: "a", newText: "b\nc" },
            { oldText: "d", newText: "" },
          ],
        },
        done: true,
      }),
    );

    assert.equal(summary.replacementCount, 2);
    assert.equal(summary.generatedLineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 replacements", "2 generated lines", "submitted"],
    );
  });

  it("falls back cleanly for malformed partial JSON", () => {
    const summary = summarizeToolDraft(
      draft("write", { argsText: '{"path":"x.ts","content":' }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.path, "x.ts");
    assert.equal(summary.lineCount, undefined);
    assert.deepEqual(summary.meta, []);
  });
});
