import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPathInside,
  resolveNativePath,
} from "../../src/execution/filesystem/native-path.js";

describe("native path boundaries", () => {
  it("resolves native, Git Bash, WSL and file URL paths on Windows", () => {
    const root = "D:\\workspace\\project";
    for (const input of [
      "C:\\Users\\Test User\\repo",
      "C:/Users/Test User/repo",
      "/c/Users/Test User/repo",
      "/mnt/c/Users/Test User/repo",
      "file:///C:/Users/Test%20User/repo",
      "file://localhost/C:/Users/Test%20User/repo",
    ]) {
      assert.equal(
        resolveNativePath(root, input, "win32"),
        "C:\\Users\\Test User\\repo",
        input,
      );
    }
    for (const input of ["/c", "/c/", "/mnt/c", "/mnt/c/"]) {
      assert.equal(resolveNativePath(root, input, "win32"), "C:\\", input);
    }
    assert.equal(
      resolveNativePath(root, "src/../test", "win32"),
      `${root}\\test`,
    );
    assert.equal(resolveNativePath(root, "/src", "win32"), "D:\\src");
  });

  it("preserves UNC shares and decodes file URLs once", () => {
    for (const input of [
      "\\\\server\\share\\Test User\\file.txt",
      "//server/share/Test User/file.txt",
      "file://server/share/Test%20User/file.txt",
    ]) {
      assert.equal(
        resolveNativePath("C:\\repo", input, "win32"),
        "\\\\server\\share\\Test User\\file.txt",
        input,
      );
    }
    assert.equal(
      resolveNativePath("C:\\repo", "file:///C:/repo/a%2520b%23.txt", "win32"),
      "C:\\repo\\a%20b#.txt",
    );
  });

  it("keeps POSIX roots and literal backslashes on macOS and Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      assert.equal(
        resolveNativePath("/work/repo", "/c/project", platform),
        "/c/project",
      );
      assert.equal(
        resolveNativePath("/work/repo", "src/../test", platform),
        "/work/repo/test",
      );
      assert.equal(
        resolveNativePath(
          "/work/repo",
          "file:///Users/Test%20User/caf%C3%A9.txt",
          platform,
        ),
        "/Users/Test User/café.txt",
      );
      assert.equal(
        resolveNativePath("/work/repo", "a\\b", platform),
        "/work/repo/a\\b",
      );
    }
  });

  it("rejects Windows parent escapes, sibling prefixes, different drives and shares", () => {
    const root = "C:\\work\\repo";
    for (const path of [root, "c:/WORK/repo/src", `${root}\\..cache`]) {
      assert.equal(isPathInside(root, path, "win32"), true, path);
    }
    for (const path of [
      "C:\\work",
      "C:\\work\\outside\\child",
      "C:\\work\\repo-other",
      "D:\\work\\repo",
      "\\\\server\\share\\repo",
    ]) {
      assert.equal(isPathInside(root, path, "win32"), false, path);
    }
    assert.equal(
      isPathInside(
        "\\\\server\\share\\repo",
        "\\\\server\\share\\outside\\child",
        "win32",
      ),
      false,
    );
    assert.equal(
      isPathInside(
        "\\\\server\\share\\repo",
        "\\\\server\\other\\repo",
        "win32",
      ),
      false,
    );
  });

  it("checks POSIX containment without rejecting dot-prefixed children", () => {
    for (const platform of ["darwin", "linux"] as const) {
      for (const path of [
        "/work/repo",
        "/work/repo/src",
        "/work/repo/..cache",
      ]) {
        assert.equal(isPathInside("/work/repo", path, platform), true, path);
      }
      for (const path of [
        "/work",
        "/work/outside/child",
        "/work/repo-other",
        "/WORK/repo",
      ]) {
        assert.equal(isPathInside("/work/repo", path, platform), false, path);
      }
      assert.equal(isPathInside("/", "/work", platform), true);
    }
  });
});
