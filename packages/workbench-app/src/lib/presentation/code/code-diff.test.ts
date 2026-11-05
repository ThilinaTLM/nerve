import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getChunks } from "@codemirror/merge";
import { EditorSelection, EditorState, Text } from "@codemirror/state";
import {
  diffChunkPosition,
  diffLineStats,
  diffOverviewMarks,
  nextChunkIndex,
  unifiedDiffExtensions,
} from "./code-diff";

const original = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
// Line 2 modified, line 5 removed, a line added after line 9.
const modified = ["a", "B", "c", "d", "f", "g", "h", "i", "new", "j"].join(
  "\n",
);

function diffState(head = 0) {
  return EditorState.create({
    doc: modified,
    selection: EditorSelection.cursor(head),
    extensions: unifiedDiffExtensions(original),
  });
}

describe("diff helpers", () => {
  it("reports overview marks for modified, removed and added lines", () => {
    const state = diffState();
    const marks = diffOverviewMarks(state).map((mark) => [
      state.doc.lineAt(mark.from).number,
      mark.kind,
    ]);
    assert.deepEqual(marks, [
      [2, "modified"],
      [5, "deleted"],
      [9, "added"],
    ]);
  });

  it("locates the cursor's change", () => {
    assert.deepEqual(diffChunkPosition(diffState(0)), {
      current: undefined,
      total: 3,
    });
    const onLineTwo = diffState(2);
    assert.deepEqual(diffChunkPosition(onLineTwo), { current: 1, total: 3 });
  });

  it("steps between changes and wraps around", () => {
    const starts = [10, 40, 90];
    assert.equal(nextChunkIndex(starts, 0, undefined, 1), 0);
    assert.equal(nextChunkIndex(starts, 50, undefined, 1), 2);
    assert.equal(nextChunkIndex(starts, 95, undefined, 1), 0);
    assert.equal(nextChunkIndex(starts, 50, undefined, -1), 1);
    assert.equal(nextChunkIndex(starts, 5, undefined, -1), 2);
    assert.equal(nextChunkIndex(starts, 40, 1, 1), 2);
    assert.equal(nextChunkIndex(starts, 10, 0, -1), 2);
    assert.equal(nextChunkIndex([], 0, undefined, 1), undefined);
  });

  it("counts added and removed lines", () => {
    const state = diffState();
    const chunks = getChunks(state)?.chunks ?? [];
    assert.deepEqual(
      diffLineStats(chunks, Text.of(original.split("\n")), state.doc),
      { added: 2, removed: 2 },
    );
  });
});
