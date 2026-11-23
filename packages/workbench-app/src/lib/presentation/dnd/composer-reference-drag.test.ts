import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPOSER_REFERENCE_DRAG_MIME,
  hasComposerReferenceDragType,
  parseComposerReferenceDrag,
  projectEntryDragReferences,
  serializeComposerReferenceDrag,
  type ComposerDragReference,
} from "./composer-reference-drag";

const references: ComposerDragReference[] = [
  { type: "project-entry", path: "src/main.ts", kind: "file" },
  { type: "project-entry", path: "src/components", kind: "directory" },
  {
    type: "launch",
    id: "launchdef_01ABC",
    label: "Dev server",
    title: "pnpm dev",
  },
];

describe("composer reference drag payload", () => {
  it("round-trips mixed references in order", () => {
    assert.deepEqual(
      parseComposerReferenceDrag(serializeComposerReferenceDrag(references)),
      references,
    );
  });

  it("canonicalizes Windows separators in project entries", () => {
    assert.deepEqual(
      parseComposerReferenceDrag(
        serializeComposerReferenceDrag(
          projectEntryDragReferences([{ path: "src\\a.ts", kind: "file" }]),
        ),
      ),
      [{ type: "project-entry", path: "src/a.ts", kind: "file" }],
    );
  });

  it("rejects malformed, unsafe and unknown payloads", () => {
    const payload = (list: unknown[]) =>
      JSON.stringify({ version: 1, references: list });
    assert.equal(parseComposerReferenceDrag("not-json"), undefined);
    assert.equal(parseComposerReferenceDrag(payload([])), undefined);
    assert.equal(
      parseComposerReferenceDrag(JSON.stringify({ version: 2, references })),
      undefined,
    );
    for (const path of ["", "/etc/passwd", "../secret", "src//a", "C:\\secret"])
      assert.equal(
        parseComposerReferenceDrag(
          payload([{ type: "project-entry", path, kind: "file" }]),
        ),
        undefined,
      );
    for (const id of ["", "a b", "@x", "x\n@file"])
      assert.equal(
        parseComposerReferenceDrag(
          payload([{ type: "launch", id, label: "x" }]),
        ),
        undefined,
      );
    assert.equal(
      parseComposerReferenceDrag(payload([{ type: "other", id: "x" }])),
      undefined,
    );
    assert.throws(() => serializeComposerReferenceDrag([]));
  });

  it("recognizes the custom MIME type", () => {
    assert.equal(
      hasComposerReferenceDragType([
        "text/plain",
        COMPOSER_REFERENCE_DRAG_MIME,
      ]),
      true,
    );
    assert.equal(hasComposerReferenceDragType(["Files"]), false);
  });
});
