import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProjectEntryPath } from "../src/ipc/project-entry-path.js";

describe("desktop project entry paths", () => {
  it("resolves nested POSIX and Windows project-relative paths", () => {
    assert.equal(
      resolveProjectEntryPath(
        { root: "/workspace/project", relativePath: "src/main.ts" },
        "linux",
      ),
      "/workspace/project/src/main.ts",
    );
    assert.equal(
      resolveProjectEntryPath(
        { root: "C:\\workspace\\project", relativePath: "src/main.ts" },
        "win32",
      ),
      "C:\\workspace\\project\\src\\main.ts",
    );
  });

  it("resolves an empty path to the project root", () => {
    assert.equal(
      resolveProjectEntryPath(
        { root: "/workspace/project", relativePath: "" },
        "linux",
      ),
      "/workspace/project",
    );
  });

  it("rejects absolute and traversing paths", () => {
    for (const relativePath of [
      "/tmp/file",
      "C:/tmp/file",
      "../file",
      "src/../../file",
      "src//file",
    ]) {
      assert.throws(() =>
        resolveProjectEntryPath(
          { root: "/workspace/project", relativePath },
          "linux",
        ),
      );
    }
    assert.throws(() =>
      resolveProjectEntryPath(
        { root: "workspace/project", relativePath: "src/main.ts" },
        "linux",
      ),
    );
  });
});
