import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPathInDirectory,
  pathKey,
  samePath,
  tildePath,
} from "./project-path";

describe("workbench path helpers", () => {
  it("compares Windows drive and UNC paths case-insensitively", () => {
    assert.equal(samePath("C:\\Users\\Alice", "c:\\users\\alice"), true);
    assert.equal(
      samePath(
        String.raw`\\SERVER\Share\Repo`,
        String.raw`\\server\share\repo`,
      ),
      true,
    );
    assert.equal(
      pathKey(String.raw`\\SERVER\Share\Repo`),
      "//server/share/repo",
    );
  });

  it("handles UNC containment without accepting sibling prefixes", () => {
    const root = String.raw`\\SERVER\Share\Repo`;
    assert.equal(
      isPathInDirectory(String.raw`\\server\share\repo\src`, root),
      true,
    );
    assert.equal(
      isPathInDirectory(String.raw`\\server\share\repo-old`, root),
      false,
    );
    assert.equal(tildePath(String.raw`\\server\share\repo\src`, root), "~/src");
  });

  it("keeps POSIX comparisons case-sensitive", () => {
    assert.equal(samePath("/Users/Alice", "/users/alice"), false);
    assert.equal(isPathInDirectory("/repo-old", "/repo"), false);
  });
});
