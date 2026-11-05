import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileTreeKeyAction } from "./files-tree-keyboard";

const key = (k: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("file tree keyboard", () => {
  it("maps plain and modified keys", () => {
    assert.deepEqual(fileTreeKeyAction(key("F2"), false), { type: "rename" });
    assert.deepEqual(fileTreeKeyAction(key("Delete"), false), {
      type: "delete",
    });
    assert.deepEqual(fileTreeKeyAction(key("x", { ctrlKey: true }), false), {
      type: "clipboard",
      mode: "cut",
    });
    assert.deepEqual(fileTreeKeyAction(key("A", { metaKey: true }), false), {
      type: "select-all",
    });
    assert.deepEqual(
      fileTreeKeyAction(key("ArrowUp", { shiftKey: true }), false),
      { type: "extend", direction: -1 },
    );
  });

  it("clears selection on Escape only while something is selected", () => {
    assert.equal(fileTreeKeyAction(key("Escape"), false), undefined);
    assert.deepEqual(fileTreeKeyAction(key("Escape"), true), {
      type: "clear-selection",
    });
  });

  it("ignores modified keys that carry extra modifiers", () => {
    assert.equal(
      fileTreeKeyAction(key("c", { ctrlKey: true, shiftKey: true }), false),
      undefined,
    );
  });
});
