import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { deleteCharBackward } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import {
  composerMentionChips,
  insertMentionsTransaction,
  mentionChipsOf,
} from "./composer-mention-chips";

const file = {
  insert: "@src/a.ts",
  label: "a.ts",
  kind: "file" as const,
  title: "src/a.ts",
};

function stateOf(doc: string, anchor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(anchor),
    extensions: composerMentionChips(),
  });
}

describe("composer mention chips", () => {
  it("inserts text with one trailing space and registers the chip", () => {
    const state = stateOf("look at ");
    const next = state.update(insertMentionsTransaction(state, [file])).state;
    assert.equal(next.doc.toString(), "look at @src/a.ts ");
    assert.deepEqual(
      mentionChipsOf(next).map(({ from, to, label }) => [from, to, label]),
      [[8, 17, "a.ts"]],
    );
    assert.equal(next.selection.main.head, 18);
  });

  it("adds a leading space when glued to text and avoids double spaces", () => {
    const state = stateOf("ab cd", 2);
    const next = state.update(
      insertMentionsTransaction(state, [
        file,
        { ...file, insert: "@b", label: "b" },
      ]),
    ).state;
    assert.equal(next.doc.toString(), "ab @src/a.ts @b cd");
    assert.equal(mentionChipsOf(next).length, 2);
  });

  it("replaces an explicit range (the typed mention token)", () => {
    const state = stateOf("see @sr", 7);
    const next = state.update(
      insertMentionsTransaction(state, [file], { from: 4, to: 7 }),
    ).state;
    assert.equal(next.doc.toString(), "see @src/a.ts ");
    assert.equal(mentionChipsOf(next)[0]?.from, 4);
  });

  it("maps chips through edits and drops partially edited ones", () => {
    const state = stateOf("x ");
    let next = state.update(insertMentionsTransaction(state, [file])).state;
    next = next.update({ changes: { from: 0, insert: "hey " } }).state;
    assert.equal(mentionChipsOf(next)[0]?.from, 6);
    next = next.update({ changes: { from: 8, insert: "Z" } }).state;
    assert.equal(mentionChipsOf(next).length, 0);
  });

  it("keeps the chip when text is appended at its edge", () => {
    const state = stateOf("");
    let next = state.update(insertMentionsTransaction(state, [file])).state;
    next = next.update({
      changes: { from: next.doc.length, insert: "go" },
    }).state;
    assert.equal(mentionChipsOf(next).length, 1);
  });

  it("Backspace removes the whole chip (atomic range)", () => {
    const state = stateOf("");
    let current = state.update(insertMentionsTransaction(state, [file])).state;
    // Drop the trailing space so the caret sits right after the chip.
    current = current.update({ changes: { from: 9, to: 10 } }).state;
    assert.equal(mentionChipsOf(current).length, 1);
    // deleteCharBackward only accepts real EditorView instances.
    const view = Object.create(EditorView.prototype, {
      state: { get: () => current },
      dispatch: {
        value: (spec: Parameters<EditorState["update"]>[0]) => {
          current = current.update(spec).state;
        },
      },
    }) as EditorView;
    assert.equal(deleteCharBackward(view), true);
    assert.equal(current.doc.toString(), "");
    assert.equal(mentionChipsOf(current).length, 0);
  });
});
