import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  defaultFileDisplayMode,
  fileRenderKind,
  isMarkdownPath,
  isMermaidPath,
  isRenderedContentEmpty,
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

  it("recognizes HTML paths but keeps editing as the default", () => {
    for (const path of [
      "wireframe.html",
      "mockups/index.htm",
      "INDEX.HTML?raw=1#header",
      "preview.HTM",
    ]) {
      assert.equal(fileRenderKind(path), "html", path);
      assert.equal(defaultFileDisplayMode(path), "raw", path);
      assert.equal(isMarkdownPath(path), false, path);
      assert.equal(isMermaidPath(path), false, path);
    }
  });

  it("keeps other files in raw mode", () => {
    for (const path of [undefined, "README", "notes.txt"]) {
      assert.equal(fileRenderKind(path), undefined, String(path));
      assert.equal(isMarkdownPath(path), false, String(path));
      assert.equal(isMermaidPath(path), false, String(path));
      assert.equal(defaultFileDisplayMode(path), "raw", String(path));
    }
  });

  it("opens files whose preview would be empty as source", () => {
    assert.equal(defaultFileDisplayMode("README.md", ""), "raw");
    assert.equal(defaultFileDisplayMode("README.md", "  \n\n"), "raw");
    assert.equal(
      defaultFileDisplayMode(
        "README.md",
        "---\ntitle: x\n---\n<!-- todo -->\n",
      ),
      "raw",
    );
    assert.equal(defaultFileDisplayMode("README.md", "# Title"), "rendered");
    assert.equal(defaultFileDisplayMode("README.md"), "rendered");
    assert.equal(defaultFileDisplayMode("flow.mmd", "%% draft\n"), "raw");
    assert.equal(
      defaultFileDisplayMode("flow.mmd", "graph TD; A-->B"),
      "rendered",
    );
    assert.equal(defaultFileDisplayMode("icon.svg", ""), "raw");
    assert.equal(defaultFileDisplayMode("icon.svg", "<svg/>"), "rendered");
    assert.equal(defaultFileDisplayMode("index.html", "<p>x</p>"), "raw");
  });

  it("detects empty rendered content", () => {
    assert.equal(isRenderedContentEmpty("markdown", "<!-- open"), true);
    assert.equal(isRenderedContentEmpty("markdown", "text <!-- c -->"), false);
    assert.equal(isRenderedContentEmpty("html", " "), true);
  });
});
