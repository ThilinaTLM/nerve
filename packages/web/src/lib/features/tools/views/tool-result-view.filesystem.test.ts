import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { CWD, toolCall } from "./tool-result-view.fixtures";

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

  it("parses a text read with relative path and line count", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "src/app.ts" },
        { path: `${CWD}/src/app.ts`, content: "a\nb\nc" },
      ),
    );
    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.relPath, "src/app.ts");
    assert.equal(view.lineLabel, "3 lines");
    assert.equal(view.image, undefined);
    assert.equal(view.content, "a\nb\nc");
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

  it("uses offset for the line label when reading a range", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "a.ts", offset: 10, limit: 3 },
        { path: `${CWD}/a.ts`, content: "x\ny\nz" },
      ),
    );
    assert.equal(view.kind === "read" && view.lineLabel, "lines 10–12");
  });

  it("parses edit diff, operation count, dry-run flag, and +/- stats", () => {
    const view = parseToolView(
      toolCall(
        "edit",
        {
          path: "src/x.ts",
          replacements: [{ oldText: "a", newText: "b" }],
          dryRun: true,
        },
        {
          path: `${CWD}/src/x.ts`,
          details: {
            diff: "@@ -1 +1 @@\n-a\n+b",
            lineEnding: "\n",
            bom: false,
            dryRun: true,
            operationCount: 1,
            operations: [
              { index: 0, type: "replace_text", matchedBy: "unique" },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.operationCount, 1);
    assert.equal(view.dryRun, true);
    assert.equal(view.additions, 1);
    assert.equal(view.deletions, 1);
  });

  it("parses write byte count", () => {
    const view = parseToolView(
      toolCall(
        "write",
        { path: "out.txt", content: "hello" },
        { path: `${CWD}/out.txt`, content: "Wrote 5 bytes." },
      ),
    );
    assert.equal(view.kind === "write" && view.bytes, 5);
  });
});
