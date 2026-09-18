import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFileDraftDirty,
  reconcileSavedFileDraft,
} from "./file-editing-state";

describe("file editing state", () => {
  it("becomes clean when an edit is undone to the baseline", () => {
    assert.equal(isFileDraftDirty("changed", "original"), true);
    assert.equal(isFileDraftDirty("original", "original"), false);
  });

  it("adopts the saved text when no newer edits exist", () => {
    assert.deepEqual(
      reconcileSavedFileDraft({
        currentDraft: "saved",
        savedDraft: "saved",
        savedText: "saved",
      }),
      { draft: "saved", dirty: false },
    );
  });

  it("preserves edits made while a save is in flight", () => {
    assert.deepEqual(
      reconcileSavedFileDraft({
        currentDraft: "newer",
        savedDraft: "saved",
        savedText: "saved",
      }),
      { draft: "newer", dirty: true },
    );
  });
});
