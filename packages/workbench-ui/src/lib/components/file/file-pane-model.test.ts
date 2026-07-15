import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFilePaneModel } from "./file-pane-model.js";
import type { FilePaneViewModel } from "./types.js";

function view(overrides: Partial<FilePaneViewModel> = {}): FilePaneViewModel {
  return {
    path: "src/example.ts",
    loading: false,
    ...overrides,
  };
}

void describe("resolveFilePaneModel", () => {
  void it("defaults Markdown files to rendered and code files to raw", () => {
    for (const path of [
      "README.md",
      "README.markdown",
      "README.mdown",
      "README.mkd",
    ]) {
      assert.equal(resolveFilePaneModel(view({ path })).displayMode, "rendered");
    }
    assert.equal(resolveFilePaneModel(view()).displayMode, "raw");
  });

  void it("honors explicit display mode before target-line defaults", () => {
    assert.equal(
      resolveFilePaneModel(
        view({ path: "README.md", line: 8, displayMode: "rendered" }),
      ).displayMode,
      "rendered",
    );
  });

  void it("defaults targeted files to raw and resolves line metadata", () => {
    const resolved = resolveFilePaneModel(
      view({
        path: "README.mdown",
        content: {
          path: "/workspace/README.mdown",
          relativePath: "README.mdown",
          name: "README.mdown",
          size: 40,
          type: "text",
          text: "hello",
          lineStart: 20,
          targetLine: 24,
        },
      }),
    );

    assert.equal(resolved.markdown, true);
    assert.equal(resolved.displayMode, "raw");
    assert.equal(resolved.lineStart, 20);
    assert.equal(resolved.targetLine, 24);
    assert.equal(resolved.textLength, 5);
    assert.equal(
      resolved.scrollSignature,
      "/workspace/README.mdown:20:24:raw:5",
    );
  });

  void it("creates image URLs only for complete image content", () => {
    const complete = resolveFilePaneModel(
      view({
        content: {
          path: "/workspace/image.png",
          name: "image.png",
          size: 3,
          type: "image",
          mimeType: "image/png",
          dataBase64: "YWJj",
        },
      }),
    );
    const missingMime = resolveFilePaneModel(
      view({
        content: {
          path: "/workspace/image.png",
          name: "image.png",
          size: 3,
          type: "image",
          dataBase64: "YWJj",
        },
      }),
    );

    assert.equal(complete.imageSrc, "data:image/png;base64,YWJj");
    assert.equal(missingMime.imageSrc, undefined);
  });

  void it("maps known source extensions to highlight languages", () => {
    assert.equal(resolveFilePaneModel(view()).language, "typescript");
  });
});
