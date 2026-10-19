import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { composerEditorTheme } from "./composer-editor-theme";

describe("composer editor theme", () => {
  // EditorView.theme puts its generated class on `.cm-editor` itself, and
  // `editorAttributes` adds state classes to that same element, so state rules
  // must be `&.class` (same element), never a descendant selector.
  it("hides the editor placeholder on the editor element while dictating", () => {
    const state = EditorState.create({ extensions: composerEditorTheme });
    const css = state
      .facet(EditorView.styleModule)
      .map((m) => m.getRules())
      .join("\n");
    assert.match(
      css,
      /\.ͼ\w+\.cm-nerve-dictating \.cm-placeholder\s*\{\s*display:\s*none/,
    );
    assert.doesNotMatch(css, /\.ͼ\w+ \.cm-nerve-dictating/);
  });
});
