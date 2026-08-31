import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolveFilePaneModel } from "./file-pane-model";

function view(path: string, line?: number) {
  return {
    path,
    line,
    loading: false,
    content: {
      path,
      relativePath: path,
      name: path.split("/").at(-1) ?? path,
      size: 10,
      type: "text" as const,
      text: "content",
    },
  };
}

describe("resolveFilePaneModel", () => {
  it("defaults renderable text files to preview", () => {
    const markdown = resolveFilePaneModel(view("README.md"));
    assert.equal(markdown.renderKind, "markdown");
    assert.equal(markdown.displayMode, "rendered");

    const mermaid = resolveFilePaneModel(view("architecture.mmd"));
    assert.equal(mermaid.renderKind, "mermaid");
    assert.equal(mermaid.displayMode, "rendered");
  });

  it("resolves Markdown links from the loaded file directory", () => {
    assert.equal(
      resolveFilePaneModel(view("/repo/docs/guide.md")).linkBasePath,
      "/repo/docs",
    );
    assert.equal(
      resolveFilePaneModel(view("C:\\repo\\docs\\guide.md")).linkBasePath,
      "C:\\repo\\docs",
    );
  });

  it("keeps ordinary and line-targeted files in code view", () => {
    const text = resolveFilePaneModel(view("notes.txt"));
    assert.equal(text.renderKind, undefined);
    assert.equal(text.displayMode, "raw");

    const targeted = resolveFilePaneModel(view("architecture.mermaid", 4));
    assert.equal(targeted.renderKind, "mermaid");
    assert.equal(targeted.displayMode, "raw");
  });

  it("honors an explicit display mode", () => {
    assert.equal(
      resolveFilePaneModel({ ...view("README.md"), displayMode: "raw" })
        .displayMode,
      "raw",
    );
  });
});
