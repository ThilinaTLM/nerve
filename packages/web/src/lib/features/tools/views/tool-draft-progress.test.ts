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
    assert.equal(summary.preview, "one\ntwo");
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

  it("uses progress snapshots for write draft previews without raw args", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        progress: {
          path: "src/live.ts",
          lineCount: 2,
          generatedLineCount: 2,
          generatedPreview: "recent one\nrecent two",
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.preview, "recent one\nrecent two");
  });

  it("tails partial write draft previews to the latest 10 completed lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: `{"path":"src/app.ts","content":"${lines.join("\\n")}`,
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.preview, lines.slice(1, 11).join("\n"));
    assert.equal(summary.preview?.includes("earlier line"), false);
  });

  it("tails progress write draft previews to the latest 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("write", {
        progress: {
          path: "src/live.ts",
          lineCount: 12,
          generatedLineCount: 12,
          generatedPreview: lines.join("\n"),
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.preview, lines.slice(-10).join("\n"));
    assert.equal(summary.preview?.includes("earlier line"), false);
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
    assert.equal(summary.preview, "one\ntwo");
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+2"],
    );
  });

  it("tails final write draft previews to the latest 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("write", {
        args: { path: "src/final.ts", content: lines.join("\n") },
        done: true,
      }),
    );

    assert.equal(summary.path, "src/final.ts");
    assert.equal(summary.lineCount, 12);
    assert.equal(summary.preview, lines.slice(-10).join("\n"));
    assert.equal(summary.preview?.includes("earlier line"), false);
  });

  it("previews partial edit generated lines without oldText", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        argsText:
          '{"replacements":[{"oldText":"old\\nexisting","newText":"new one\\nnew two\\nnew thre',
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.preview, "new one\nnew two");
    assert.equal(summary.previewLanguage, undefined);
  });

  it("previews partial edit patch lines as diff", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        argsText: '{"path":"x.ts","patch":"@@ -1 +1 @@\\n-old\\n+new',
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.preview, "@@ -1 +1 @@\n-old");
    assert.equal(summary.previewLanguage, "diff");
  });

  it("uses progress snapshots for edit operation drafts without raw args", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        progress: {
          path: "src/live.ts",
          operationCount: 2,
          generatedLineCount: 6,
          estimatedAdditions: 6,
          estimatedDeletions: 4,
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.toolName, "edit");
    assert.equal(summary.path, "src/live.ts");
    assert.equal(summary.operationCount, 2);
    assert.equal(summary.generatedLineCount, 6);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 operations", "+6", "-4"],
    );
  });

  it("uses progress snapshots for edit draft previews without raw args", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        progress: {
          path: "src/live.ts",
          operationCount: 1,
          generatedLineCount: 1,
          estimatedAdditions: 1,
          estimatedDeletions: 1,
          generatedPreview: "@@ -1 +1 @@\n-old\n+new",
          generatedPreviewLanguage: "diff",
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.preview, "@@ -1 +1 @@\n-old\n+new");
    assert.equal(summary.previewLanguage, "diff");
  });

  it("uses final edit shorthand args for operation and generated-line counts", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        args: {
          path: "src/app.ts",
          lineInsertions: [{ line: 1, position: "before", text: "a\nb" }],
          replacements: [{ oldText: "old", newText: "new" }],
          patch: "@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
        },
        done: true,
      }),
    );

    assert.equal(summary.toolName, "edit");
    assert.equal(summary.operationCount, 3);
    assert.equal(summary.generatedLineCount, 5);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["3 operations", "+5", "-2"],
    );
  });

  it("tails final edit generated previews to the latest 10 lines without oldText", () => {
    const replacementLines = Array.from(
      { length: 6 },
      (_, index) => `replacement-${index + 1}`,
    );
    const insertionLines = Array.from(
      { length: 4 },
      (_, index) => `insertion-${index + 1}`,
    );
    const patchLines = ["@@ -1 +1 @@", "-removed", "+added"];
    const summary = summarizeToolDraft(
      draft("edit", {
        args: {
          path: "src/app.ts",
          replacements: [
            {
              oldText: "old secret should not render",
              newText: replacementLines.join("\n"),
            },
          ],
          insertions: [{ text: insertionLines.join("\n") }],
          patch: patchLines.join("\n"),
        },
        done: true,
      }),
    );

    const generatedLines = [
      ...replacementLines,
      ...insertionLines,
      ...patchLines,
    ];
    assert.equal(summary.toolName, "edit");
    assert.equal(summary.preview, generatedLines.slice(-10).join("\n"));
    assert.equal(summary.preview?.includes("old secret"), false);
    assert.equal(summary.preview?.includes("earlier line"), false);
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

  it("summarizes Python file path drafts", () => {
    const summary = summarizeToolDraft(
      draft("python", {
        argsText: '{"path":"scripts/report.py"',
        args: { path: "scripts/report.py" },
        done: true,
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.path, "scripts/report.py");
    assert.equal(summary.code, undefined);
    assert.equal(summary.statusText, "Submitting Python file…");
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["file", "submitted"],
    );
  });

  it("waits cleanly for early Python drafts before code or path starts", () => {
    const summary = summarizeToolDraft(
      draft("python", { argsText: '{"timeout": 5, "code":' }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, undefined);
    assert.equal(summary.statusText, "Waiting for Python code or path…");
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

  it("relativizes absolute draft paths against the project cwd", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"/home/u/proj/src/app.ts","content":"one\\ntwo',
      }),
      "/home/u/proj",
    );

    assert.equal(summary.path, "src/app.ts");
  });

  it("leaves out-of-cwd draft paths intact", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"/etc/hosts","content":"x',
      }),
      "/home/u/proj",
    );

    assert.equal(summary.path, "/etc/hosts");
  });
});
