import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPathInDirectoryTree } from "../../../src/domains/tasks/index.js";

describe("task directory scope", () => {
  it("uses Windows path semantics for Windows project roots", () => {
    assert.equal(
      isPathInDirectoryTree("C:\\Work\\Project", "C:\\Work\\Project"),
      true,
    );
    assert.equal(
      isPathInDirectoryTree(
        "C:\\Work\\Project",
        "C:\\Work\\Project\\apps\\api",
      ),
      true,
    );
    assert.equal(
      isPathInDirectoryTree("C:\\Work\\Project", "C:\\Work\\Project-other"),
      false,
    );
    assert.equal(isPathInDirectoryTree("C:\\Work\\Project", "C:\\Work"), false);
    assert.equal(
      isPathInDirectoryTree("C:\\Work\\Project", "c:\\work\\project\\src"),
      true,
    );
    assert.equal(
      isPathInDirectoryTree("C:\\Work\\Project", "D:\\Work\\Project"),
      false,
    );
  });
});
