import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectedTextForTranscriptRow } from "./transcript-context-selection";

const row = {} as Node;

function selection(options: {
  text?: string;
  collapsed?: boolean;
  intersections?: boolean[];
}) {
  const intersections = options.intersections ?? [true];
  return {
    isCollapsed: options.collapsed ?? false,
    rangeCount: intersections.length,
    getRangeAt(index: number) {
      return { intersectsNode: () => intersections[index] ?? false };
    },
    toString: () => options.text ?? "selected text",
  };
}

describe("transcript context selection", () => {
  it("returns a non-collapsed selection inside the row", () => {
    assert.equal(
      selectedTextForTranscriptRow(selection({}), row),
      "selected text",
    );
  });

  it("returns a selection spanning multiple rows for an intersected row", () => {
    assert.equal(
      selectedTextForTranscriptRow(
        selection({ text: "across rows", intersections: [false, true] }),
        row,
      ),
      "across rows",
    );
  });

  it("rejects collapsed, whitespace-only, and non-overlapping selections", () => {
    assert.equal(
      selectedTextForTranscriptRow(selection({ collapsed: true }), row),
      undefined,
    );
    assert.equal(
      selectedTextForTranscriptRow(selection({ text: "  \n" }), row),
      undefined,
    );
    assert.equal(
      selectedTextForTranscriptRow(selection({ intersections: [false] }), row),
      undefined,
    );
  });

  it("rejects a missing selection", () => {
    assert.equal(selectedTextForTranscriptRow(null, row), undefined);
  });
});
