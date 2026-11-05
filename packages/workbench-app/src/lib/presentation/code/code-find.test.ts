import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { searchFieldText } from "./code-find.svelte";

function matches(doc: string, search: string, regexp = false): number {
  const state = EditorState.create({ doc });
  const cursor = new SearchQuery({ search, regexp }).getCursor(state);
  let count = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) count += 1;
  return count;
}

describe("find field seeding", () => {
  it("turns multi-line selections into a one-line pattern that still matches", () => {
    const selection = "if (a) {\n  b();";
    const field = searchFieldText(selection, false);
    assert.equal(field.includes("\n"), false);
    assert.equal(matches(`x\n${selection}\n}`, field), 1);
  });

  it("keeps backslashes literal in plain-text search", () => {
    const selection = String.raw`C:\new\table`;
    assert.equal(
      matches(`path ${selection}`, searchFieldText(selection, false)),
      1,
    );
  });
});
