import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prFileDiffStateKey } from "./pr-file-diff";

describe("PR file diff identity", () => {
  it("includes both refs and rename metadata", () => {
    const first = prFileDiffStateKey("base-a", "head-a", {
      path: "src/new.ts",
      previousPath: "src/old.ts",
      status: "renamed",
    });
    assert.notEqual(
      first,
      prFileDiffStateKey("base-b", "head-a", {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        status: "renamed",
      }),
    );
    assert.notEqual(
      first,
      prFileDiffStateKey("base-a", "head-b", {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        status: "renamed",
      }),
    );
    assert.notEqual(
      first,
      prFileDiffStateKey("base-a", "head-a", {
        path: "src/new.ts",
        status: "modified",
      }),
    );
  });
});
