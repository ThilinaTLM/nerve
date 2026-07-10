import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAbsoluteLocalPath,
  joinLocalPath,
  parseLocalFileHref,
  relativePathForDisplay,
  resolveDisplayPath,
  splitPathLineSuffix,
} from "./path-links";

describe("path link helpers", () => {
  it("detects Windows and POSIX absolute paths", () => {
    assert.equal(isAbsoluteLocalPath("/tmp/project/file.ts"), true);
    assert.equal(isAbsoluteLocalPath("C:\\Users\\me\\repo\\file.ts"), true);
    assert.equal(isAbsoluteLocalPath("C:/Users/me/repo/file.ts"), true);
    assert.equal(isAbsoluteLocalPath("\\\\server\\share\\file.ts"), true);
    assert.equal(isAbsoluteLocalPath("src/file.ts"), false);
  });

  it("joins relative paths using the base path style", () => {
    assert.equal(
      joinLocalPath("C:\\Users\\me\\repo", "src/App.svelte"),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
    assert.equal(
      joinLocalPath("/tmp/project", "src/App.svelte"),
      "/tmp/project/src/App.svelte",
    );
  });

  it("resolves display paths without prefixing Windows absolutes", () => {
    assert.equal(
      resolveDisplayPath("src/App.svelte", "C:\\Users\\me\\repo"),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
    assert.equal(
      resolveDisplayPath(
        "C:\\Users\\me\\repo\\src\\App.svelte",
        "C:\\Users\\me\\repo",
      ),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("computes relative display paths for drive-letter paths case-insensitively", () => {
    assert.equal(
      relativePathForDisplay(
        "C:\\Users\\me\\repo\\src\\App.svelte",
        "c:/Users/me/repo",
      ),
      "src/App.svelte",
    );
  });

  it("parses local file hrefs and ignores external protocols", () => {
    assert.equal(
      parseLocalFileHref("file:///C:/Users/me/My%20Repo/App.svelte"),
      "C:/Users/me/My Repo/App.svelte",
    );
    assert.equal(
      parseLocalFileHref("file://server/share/App.svelte"),
      "//server/share/App.svelte",
    );
    assert.equal(parseLocalFileHref("src/App.svelte?raw"), "src/App.svelte");
    for (const href of [
      "https://example.test/App.svelte",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,hello",
      "mailto:hello@example.test",
      "#fragment",
    ]) {
      assert.equal(parseLocalFileHref(href), undefined);
    }
  });

  it("splits line suffixes without treating drive letters as lines", () => {
    assert.deepEqual(splitPathLineSuffix("src/App.svelte:42"), {
      path: "src/App.svelte",
      line: 42,
    });
    assert.deepEqual(
      splitPathLineSuffix("C:\\Users\\me\\repo\\src\\App.svelte:42"),
      {
        path: "C:\\Users\\me\\repo\\src\\App.svelte",
        line: 42,
      },
    );
    assert.deepEqual(splitPathLineSuffix("C:"), { path: "C:" });
  });
});
