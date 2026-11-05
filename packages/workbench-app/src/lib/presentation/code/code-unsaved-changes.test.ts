import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState } from "@codemirror/state";
import {
  unsavedChangesExtension,
  unsavedMarkersOf,
  updateUnsavedChangesBaseline,
} from "./code-unsaved-changes";

const markers = unsavedMarkersOf;

describe("unsaved change markers", () => {
  it("tracks draft edits and clears when the draft returns to the baseline", () => {
    let state = EditorState.create({
      doc: "alpha\nbeta",
      extensions: unsavedChangesExtension("alpha\nbeta"),
    });
    assert.deepEqual(markers(state), []);

    state = state.update({
      changes: { from: 6, to: 10, insert: "gamma" },
    }).state;
    assert.deepEqual(markers(state), [{ line: 2, kind: "modified" }]);

    state = state.update({
      changes: { from: 6, to: 11, insert: "beta" },
    }).state;
    assert.deepEqual(markers(state), []);
  });

  it("marks inserted lines as added and deletions between lines", () => {
    const inserted = EditorState.create({
      doc: "alpha\nbeta\ngamma",
      extensions: unsavedChangesExtension("alpha\ngamma"),
    });
    assert.deepEqual(markers(inserted), [{ line: 2, kind: "added" }]);

    const deleted = EditorState.create({
      doc: "alpha\ngamma",
      extensions: unsavedChangesExtension("alpha\nbeta\ngamma"),
    });
    assert.deepEqual(markers(deleted), [{ line: 2, kind: "deleted-above" }]);

    const trailing = EditorState.create({
      doc: "alpha\nbeta",
      extensions: unsavedChangesExtension("alpha\nbeta\ngamma"),
    });
    assert.deepEqual(markers(trailing), [{ line: 2, kind: "deleted-below" }]);
  });

  it("clears changes when the persisted baseline catches up", () => {
    let state = EditorState.create({
      doc: "saved draft",
      extensions: unsavedChangesExtension("old content"),
    });
    assert.equal(markers(state).length, 1);

    state = state.update({
      effects: updateUnsavedChangesBaseline(state, "saved draft"),
    }).state;

    assert.deepEqual(markers(state), []);
  });

  it("compares CRLF baselines with the document's line separator", () => {
    const state = EditorState.create({
      doc: "alpha\r\nbeta",
      extensions: [
        EditorState.lineSeparator.of("\r\n"),
        unsavedChangesExtension("alpha\r\nbeta"),
      ],
    });
    assert.deepEqual(markers(state), []);
  });
});
