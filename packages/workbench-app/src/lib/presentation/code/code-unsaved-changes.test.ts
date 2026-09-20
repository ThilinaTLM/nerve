import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getChunks } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import {
  unsavedChangesExtension,
  updateUnsavedChangesBaseline,
} from "./code-unsaved-changes";

function chunks(state: EditorState) {
  return getChunks(state)?.chunks ?? [];
}

describe("unsaved change markers", () => {
  it("tracks draft edits and clears when the draft returns to the baseline", () => {
    let state = EditorState.create({
      doc: "alpha\nbeta",
      extensions: unsavedChangesExtension("alpha\nbeta"),
    });
    assert.equal(chunks(state).length, 0);

    state = state.update({
      changes: { from: 6, to: 10, insert: "gamma" },
    }).state;
    assert.equal(chunks(state).length, 1);

    state = state.update({
      changes: { from: 6, to: 11, insert: "beta" },
    }).state;
    assert.equal(chunks(state).length, 0);
  });

  it("tracks inserted and deleted lines", () => {
    const inserted = EditorState.create({
      doc: "alpha\nbeta\ngamma",
      extensions: unsavedChangesExtension("alpha\ngamma"),
    });
    const deleted = EditorState.create({
      doc: "alpha\ngamma",
      extensions: unsavedChangesExtension("alpha\nbeta\ngamma"),
    });

    assert.equal(chunks(inserted).length, 1);
    assert.equal(chunks(inserted)[0]?.fromA, chunks(inserted)[0]?.toA);
    assert.equal(chunks(deleted).length, 1);
    assert.equal(chunks(deleted)[0]?.fromB, chunks(deleted)[0]?.toB);
  });

  it("clears changes when the persisted baseline catches up", () => {
    let state = EditorState.create({
      doc: "saved draft",
      extensions: unsavedChangesExtension("old content"),
    });
    assert.equal(chunks(state).length, 1);

    state = state.update({
      effects: updateUnsavedChangesBaseline(state, "saved draft"),
    }).state;

    assert.equal(chunks(state).length, 0);
  });
});
