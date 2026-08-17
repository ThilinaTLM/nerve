import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECT_ENTRY_DRAG_MIME,
  formatProjectEntryReference,
  formatProjectEntryReferences,
  hasProjectEntryDragType,
  parseProjectEntryDrag,
  serializeProjectEntryDrag,
  type ProjectEntryDragItem,
} from "./project-entry-drag";

const entries: ProjectEntryDragItem[] = [
  { path: "src/main.ts", kind: "file" },
  { path: "src/components", kind: "directory" },
];

describe("project entry drag payload", () => {
  it("round-trips entries in order", () => {
    assert.deepEqual(
      parseProjectEntryDrag(serializeProjectEntryDrag(entries)),
      entries,
    );
  });

  it("canonicalizes Windows and mixed relative separators", () => {
    const windowsEntries: ProjectEntryDragItem[] = [
      { path: "src\\main.ts", kind: "file" },
      { path: "src\\components/button.svelte", kind: "file" },
    ];
    assert.deepEqual(
      parseProjectEntryDrag(serializeProjectEntryDrag(windowsEntries)),
      [
        { path: "src/main.ts", kind: "file" },
        { path: "src/components/button.svelte", kind: "file" },
      ],
    );
  });

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

  it("rejects malformed and unsafe payloads", () => {
    assert.equal(parseProjectEntryDrag("not-json"), undefined);
    assert.equal(
      parseProjectEntryDrag(JSON.stringify({ version: 2, entries })),
      undefined,
    );
    for (const path of [
      "",
      "/etc/passwd",
      "../secret",
      "src/../secret",
      "src//secret",
      "C:\\secret",
      "\\\\server\\share\\secret",
    ])
      assert.equal(
        parseProjectEntryDrag(
          JSON.stringify({ version: 1, entries: [{ path, kind: "file" }] }),
        ),
        undefined,
      );
    assert.equal(
      parseProjectEntryDrag(
        JSON.stringify({
          version: 1,
          entries: [{ path: "src", kind: "other" }],
        }),
      ),
      undefined,
    );
  });

  it("recognizes the custom MIME type", () => {
    assert.equal(
      hasProjectEntryDragType(["text/plain", PROJECT_ENTRY_DRAG_MIME]),
      true,
    );
    assert.equal(hasProjectEntryDragType(["Files"]), false);
  });
});
