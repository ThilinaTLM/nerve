import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatProjectEntryReference,
  formatProjectEntryReferences,
  type ProjectEntryDragItem,
} from "./project-entry-drag";

const entries: ProjectEntryDragItem[] = [
  { path: "src/main.ts", kind: "file" },
  { path: "src/components", kind: "directory" },
];

describe("project entry references", () => {
  it("formats file and directory references", () => {
    assert.deepEqual(formatProjectEntryReferences(entries), [
      "@src/main.ts",
      "@src/components/",
    ]);
  });

  it("quotes whitespace and escapes quotes", () => {
    assert.equal(
      formatProjectEntryReference({
        path: "docs/design notes.md",
        kind: "file",
      }),
      '"@docs/design notes.md"',
    );
    assert.equal(
      formatProjectEntryReference({
        path: 'docs/a "draft"',
        kind: "directory",
      }),
      '"@docs/a \\"draft\\"/"',
    );
  });
});
