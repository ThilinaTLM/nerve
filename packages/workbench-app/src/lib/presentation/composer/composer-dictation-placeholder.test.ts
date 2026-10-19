import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import {
  composerDictationPlaceholder,
  dictationPlaceholderPosition,
  startDictation,
} from "./composer-dictation-placeholder";

/** Minimal DOM-free view: applies transactions and runs update listeners. */
function fakeView(doc: string, anchor?: number, head?: number) {
  let state = EditorState.create({
    doc,
    selection:
      anchor === undefined
        ? undefined
        : EditorSelection.single(anchor, head ?? anchor),
    extensions: composerDictationPlaceholder(),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      const tr = state.update(spec);
      const startState = state;
      state = tr.state;
      for (const listener of state.facet(EditorView.updateListener)) {
        listener({
          startState,
          state,
          transactions: [tr],
          view,
        } as unknown as ViewUpdate);
      }
    },
  };
  return view as unknown as EditorView & { state: EditorState };
}

/** Simulate a user selecting (so a caret counts as placed). */
function placeCaret(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos }, userEvent: "select" });
}

describe("composer dictation placeholder", () => {
  it("starts at the end when no caret was ever placed", () => {
    const view = fakeView("hello");
    startDictation(view);
    assert.equal(dictationPlaceholderPosition(view.state), 5);
    assert.equal(view.state.doc.toString(), "hello");
  });

  it("starts at the placed caret and returns the live handle", () => {
    const view = fakeView("hello world");
    placeCaret(view, 5);
    const handle = startDictation(view);
    assert.equal(dictationPlaceholderPosition(view.state), 5);
    assert.equal(startDictation(view), handle);
    assert.equal(handle.active, true);
  });

  it("replaces a selection when starting", () => {
    const view = fakeView("one two three", 4, 7);
    startDictation(view);
    assert.equal(view.state.doc.toString(), "one  three");
    assert.equal(dictationPlaceholderPosition(view.state), 4);
  });

  it("resolve inserts with smart spacing in one transaction", () => {
    const view = fakeView("abcd");
    placeCaret(view, 2);
    const handle = startDictation(view);
    handle.update("transcribing", 3000);
    handle.resolve(" hi there ");
    assert.equal(view.state.doc.toString(), "ab hi there cd");
    assert.equal(handle.active, false);
    assert.equal(dictationPlaceholderPosition(view.state), undefined);
  });

  it("does not add spaces next to existing whitespace or edges", () => {
    const view = fakeView("a b", 2);
    placeCaret(view, 2);
    startDictation(view).resolve("x");
    assert.equal(view.state.doc.toString(), "a x b");
  });

  it("maps with edits elsewhere and reports user deletion across it", () => {
    const view = fakeView("abcdef");
    placeCaret(view, 3);
    const handle = startDictation(view);
    let removed = 0;
    handle.onRemoved(() => removed++);
    view.dispatch({ changes: { from: 0, insert: "XX" } });
    assert.equal(dictationPlaceholderPosition(view.state), 5);
    view.dispatch({ changes: { from: 4, to: 7 } });
    assert.equal(handle.active, false);
    assert.equal(removed, 1);
  });

  it("cancel removes silently", () => {
    const view = fakeView("abc");
    const handle = startDictation(view);
    let removed = 0;
    handle.onRemoved(() => removed++);
    handle.cancel();
    assert.equal(handle.active, false);
    assert.equal(removed, 0);
    assert.equal(view.state.doc.toString(), "abc");
  });
});
