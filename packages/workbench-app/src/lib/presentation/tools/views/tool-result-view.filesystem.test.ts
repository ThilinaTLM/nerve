import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { CWD, toolCall, transcriptToolCall } from "./tool-result-view.fixtures";

describe("parseToolView filesystem read/write/edit", () => {
  it("resolves relative read paths against Windows cwd", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "src/App.svelte" },
        { path: "src/App.svelte", content: "hello" },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.path, "C:\\Users\\me\\repo\\src\\App.svelte");
    assert.equal(view.relPath, "src/App.svelte");
  });

  it("does not prefix absolute Windows read paths", () => {
    const absolutePath = "C:\\Users\\me\\repo\\src\\App.svelte";
    const view = parseToolView(
      toolCall(
        "read",
        { path: absolutePath },
        { path: absolutePath, content: "hello" },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.path, absolutePath);
    assert.equal(view.relPath, "src/App.svelte");
  });

  it("parses an image read into a data URL", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "logo.png" },
        {
          path: `${CWD}/logo.png`,
          content: "Read image file [image/png]",
          contentBlocks: [
            { type: "text", text: "Read image file [image/png]" },
            { type: "image", data: "QUJD", mimeType: "image/png" },
          ],
        },
      ),
    );
    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.image?.dataUrl, "data:image/png;base64,QUJD");
  });

  it("parses display fields from bounded edit transcript details", () => {
    const view = parseToolView(
      transcriptToolCall(
        "edit",
        { path: "src/x.ts", edits: [] },
        {
          path: `${CWD}/src/x.ts`,
          details: {
            diff: "@@ -1 +1 @@\n-a\n+b",
            operationCount: 2,
            dryRun: true,
          },
        },
        {
          previewOverflow: {
            hidden: 4,
            noun: "lines",
            direction: "tail",
          },
        },
      ),
    );

    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.diff, "@@ -1 +1 @@\n-a\n+b");
    assert.equal(view.operationCount, 2);
    assert.equal(view.dryRun, true);
    assert.equal(view.additions, 1);
    assert.equal(view.deletions, 1);
    assert.equal(view.diffLineCount, 7);
  });

  it("keeps malformed edit diffs absent", () => {
    const view = parseToolView(
      transcriptToolCall(
        "edit",
        { path: "src/x.ts", edits: [{ oldText: "a", newText: "b" }] },
        {
          path: `${CWD}/src/x.ts`,
          details: { diff: 42, operationCount: 3, dryRun: false },
        },
      ),
    );

    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.diff, undefined);
    assert.equal(view.operationCount, 3);
    assert.equal(view.additions, 0);
    assert.equal(view.deletions, 0);
    assert.equal(view.diffLineCount, 0);
  });

  it("parses edit diff, operation count, and +/- stats", () => {
    const view = parseToolView(
      toolCall(
        "edit",
        {
          path: "src/x.ts",
          edits: [{ oldText: "a", newText: "b" }],
        },
        {
          path: `${CWD}/src/x.ts`,
          details: {
            diff: "@@ -1 +1 @@\n-a\n+b",
            lineEnding: "\n",
            bom: false,
            operationCount: 1,
            operations: [
              {
                index: 0,
                type: "replace_text",
                source: "edits",
                sourceIndex: 0,
                matchCount: 1,
                startLine: 1,
                endLine: 1,
                matchedBy: "unique",
              },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.operationCount, 1);
    assert.equal(view.additions, 1);
    assert.equal(view.deletions, 1);
  });
});
