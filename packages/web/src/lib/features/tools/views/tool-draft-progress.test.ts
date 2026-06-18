import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveToolCallDraft } from "$lib/core/types/state-types";
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
    assert.equal(summary.statusText, "Generating");
    assert.equal(summary.lineCount, 3);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+3"],
    );
  });

  it("uses progress snapshots for write drafts without raw args", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        progress: {
          path: "src/live.ts",
          lineCount: 12,
          generatedLineCount: 12,
          estimated: true,
        },
      }),
    );

    assert.equal(summary.path, "src/live.ts");
    assert.equal(summary.lineCount, 12);
    assert.equal(summary.generatedLineCount, 12);
    assert.equal(summary.estimated, true);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+12"],
    );
  });

  it("uses final write args for exact path and line count", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"src/old.ts","content":"partial',
        progress: {
          path: "src/live.ts",
          lineCount: 99,
          generatedLineCount: 99,
          estimated: true,
        },
        args: { path: "src/final.ts", content: "one\ntwo" },
        done: true,
      }),
    );

    assert.equal(summary.path, "src/final.ts");
    assert.equal(summary.statusText, "Submitting");
    assert.equal(summary.lineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+2"],
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
    assert.equal(summary.statusText, "Generating");
    assert.equal(summary.replacementCount, 2);
    assert.equal(summary.generatedLineCount, 3);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+3", "-2"],
    );
  });

  it("uses progress snapshots for edit drafts without raw args", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        progress: {
          path: "src/live.ts",
          replacementCount: 3,
          generatedLineCount: 8,
          estimatedAdditions: 8,
          estimatedDeletions: 5,
          estimated: true,
        },
      }),
    );

    assert.equal(summary.path, "src/live.ts");
    assert.equal(summary.replacementCount, 3);
    assert.equal(summary.generatedLineCount, 8);
    assert.equal(summary.estimatedAdditions, 8);
    assert.equal(summary.estimatedDeletions, 5);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+8", "-5"],
    );
  });

  it("hides edit draft chips until non-zero counts are known", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        progress: {
          path: "src/live.ts",
          replacementCount: 0,
          generatedLineCount: 0,
          estimatedAdditions: 0,
          estimatedDeletions: 0,
          estimated: true,
        },
      }),
    );

    assert.equal(summary.path, "src/live.ts");
    assert.deepEqual(summary.meta, []);
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
      ["+2", "-2"],
    );
  });

  it("extracts partial Python code from streamed JSON", () => {
    const summary = summarizeToolDraft(
      draft("python", {
        argsText: '{"code":"import os\\nprint(os.getcwd())',
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, "import os\nprint(os.getcwd())");
    assert.equal(summary.codeLineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 code lines"],
    );
  });

  it("uses final Python args for exact submitted code", () => {
    const summary = summarizeToolDraft(
      draft("python", {
        argsText: '{"code":"partial',
        args: { code: "print('hello')\nprint('done')" },
        done: true,
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, "print('hello')\nprint('done')");
    assert.equal(summary.codeLineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 code lines", "submitted"],
    );
  });

  it("waits cleanly for early Python drafts before code starts", () => {
    const summary = summarizeToolDraft(
      draft("python", { argsText: '{"timeout": 5, "code":' }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, undefined);
    assert.equal(summary.statusText, "Waiting for Python code…");
    assert.deepEqual(summary.meta, []);
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
