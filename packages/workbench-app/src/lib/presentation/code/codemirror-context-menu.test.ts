import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { contextSelection } from "./codemirror-context-menu";

test("preserves a selection when context-clicking inside it", () => {
  const state = EditorState.create({
    doc: "hello world",
    selection: EditorSelection.single(0, 5),
  });
  assert.equal(contextSelection(state, 3), undefined);
});

test("moves the cursor when context-clicking outside the selection", () => {
  const state = EditorState.create({
    doc: "hello world",
    selection: EditorSelection.single(0, 5),
  });
  assert.deepEqual(contextSelection(state, 8), { anchor: 8 });
});
