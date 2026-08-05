import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  defaultFileDisplayMode,
  fileRenderKind,
  isMarkdownPath,
  isMermaidPath,
} from "./file-display";

describe("file display classification", () => {
  it("recognizes Markdown paths", () => {
    for (const path of [
      "README.md",
      "docs/guide.markdown",
      "notes.mdown",
      "legacy.mkd",
      "README.MD?raw=1#intro",
    ]) {
      assert.equal(fileRenderKind(path), "markdown", path);
      assert.equal(isMarkdownPath(path), true, path);
      assert.equal(defaultFileDisplayMode(path), "rendered", path);
    }
  });

  it("recognizes Mermaid paths", () => {
    for (const path of [
      "architecture.mmd",
      "docs/flow.mermaid",
      "FLOW.MMD?raw=1#diagram",
    ]) {
      assert.equal(fileRenderKind(path), "mermaid", path);
      assert.equal(isMermaidPath(path), true, path);
      assert.equal(defaultFileDisplayMode(path), "rendered", path);
    }
  });

  it("keeps other files in raw mode", () => {
    for (const path of [undefined, "README", "diagram.svg", "notes.txt"]) {
      assert.equal(fileRenderKind(path), undefined, String(path));
      assert.equal(isMarkdownPath(path), false, String(path));
      assert.equal(isMermaidPath(path), false, String(path));
      assert.equal(defaultFileDisplayMode(path), "raw", String(path));
    }
  });
});
