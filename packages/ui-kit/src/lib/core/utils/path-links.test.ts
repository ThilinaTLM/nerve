import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  localPathDirectory,
  parseLocalFileHref,
  resolveDisplayPath,
  splitPathLineSuffix,
} from "./path-links";

describe("path link helpers", () => {
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

  it("finds local containing directories across path styles", () => {
    assert.equal(localPathDirectory("README.md"), ".");
    assert.equal(localPathDirectory("docs/guide.md"), "docs");
    assert.equal(localPathDirectory("/repo/README.md"), "/repo");
    assert.equal(localPathDirectory("/README.md"), "/");
    assert.equal(
      localPathDirectory("C:\\Users\\me\\repo\\README.md"),
      "C:\\Users\\me\\repo",
    );
    assert.equal(localPathDirectory("C:\\README.md"), "C:\\");
    assert.equal(
      localPathDirectory("\\\\server\\share\\README.md"),
      "\\\\server\\share",
    );
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
