import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIncomingFilePath } from "../src/routes/filesystem-routes";

describe("normalizeIncomingFilePath", () => {
  const root = "C:\\Users\\me\\repo";

  it("resolves relative Windows paths against the project root", () => {
    assert.equal(
      normalizeIncomingFilePath(root, "src/App.svelte", "win32"),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("keeps native Windows absolute paths absolute", () => {
    assert.equal(
      normalizeIncomingFilePath(
        root,
        "C:\\Users\\me\\repo\\src\\App.svelte",
        "win32",
      ),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("translates Git Bash drive paths on Windows", () => {
    assert.equal(
      normalizeIncomingFilePath(
        root,
        "/c/Users/me/repo/src/App.svelte",
        "win32",
      ),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("translates WSL-style drive paths on Windows", () => {
    assert.equal(
      normalizeIncomingFilePath(
        root,
        "/mnt/c/Users/me/repo/src/App.svelte",
        "win32",
      ),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("translates file URLs on Windows", () => {
    assert.equal(
      normalizeIncomingFilePath(
        root,
        "file:///C:/Users/me/repo/src/App.svelte",
        "win32",
      ),
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });
});
